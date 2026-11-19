const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fibu-http-'));
process.env.DB_PATH=path.join(tmp,'portal.db');
process.env.FIBU_RUNNER_SECRET=require('node:crypto').randomBytes(32).toString('base64url');
const {createApp}=require('../src/app');
const {upsertUser}=require('../src/users');
const db=require('../src/db');
const {hash}=require('../src/fibu/core');
const pdf=require('../src/fibu/pdf');
let server,child,base,cookie,csrf;
test.after(async()=>{if(child){child.kill('SIGINT');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill();resolve();},4000).unref();});}if(server)await new Promise(r=>server.close(r));db.close();await fsp.rm(tmp,{recursive:true,force:true});});
test('Portal ↔ Windows-Dienst: echte lokale HTTP-Kopplung, PDF und manuelle Aufhebung',async()=>{
 const folder=path.join(tmp,'2026','10'),collection=path.join(tmp,'collection');await fsp.mkdir(folder,{recursive:true});await fsp.mkdir(collection);
 const {PDFDocument}=await import('../vendor/pdf-lib.mjs');
 async function fixture(lines){const doc=await PDFDocument.create(),p=doc.addPage([900,842]);lines.forEach((s,i)=>p.drawText(s,{x:30,y:790-i*25,size:11}));return Buffer.from(await doc.save());}
 const bank=await fixture(['TestConsulting CC GmbH','DE02120300000000202051','Auszugszeitraum: 01.10.2026 bis 31.10.2026','12.10.2026 Microsoft | Rechnung G194101447 -136,45 EUR']);
 const invoice=await fixture(['TestConsulting CC GmbH','Rechnungssteller: Microsoft','Rechnungsnummer: G194101447','Gesamtbetrag: 136,45 EUR']);
 const bankPath=path.join(folder,'Bank.pdf');await fsp.writeFile(bankPath,bank);await fsp.writeFile(path.join(folder,'Invoice.pdf'),invoice);
 const company={enabled:true,root:tmp,collectionFolder:collection,accountHolder:'TestConsulting CC GmbH',iban:'DE02120300000000202051',documentCompanyName:'TestConsulting CC GmbH',allowedUsers:['pilot@example.invalid','other@example.invalid']};
 const config={mode:'remote',companies:{tc:company}};
 await upsertUser({email:'pilot@example.invalid',firstName:'Pilot',lastName:'Test',password:'synthetic-test-only!'});
 await upsertUser({email:'other@example.invalid',firstName:'Other',lastName:'Test',password:'synthetic-test-only!'});
 const ms={configured:true,connected:()=>false,begin:async()=>({userCode:'SYNTHETIC-CODE',verificationUri:'https://microsoft.com/devicelogin',interval:5,expiresIn:900})};
 server=createApp({sessionSecret:'synthetic-session-secret',fibu:{config,ms}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 async function login(email){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'synthetic-test-only!'})});return {cookie:r.headers.get('set-cookie').split(';')[0],...await r.json()};}
 const auth=await login('pilot@example.invalid');cookie=auth.cookie;csrf=auth.csrfToken;
 const api=(url,body,authCookie=cookie,token=csrf)=>fetch(base+'/api/fibu'+url,{headers:{Cookie:authCookie,'Content-Type':'application/json','X-CSRF-Token':token},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 assert.equal((await fetch(base+'/api/fibu/companies')).status,401);
 assert.equal((await fetch(base+'/api/fibu-runner/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await api('/jobs',{companyId:'tc',monthFolderPath:folder,bankPdfPath:bankPath},cookie,'wrong')).status,403);
 assert.equal((await api('/jobs',{companyId:'immo',monthFolderPath:folder,bankPdfPath:bankPath})).status,403);
 const request={companyId:'tc',monthFolderPath:folder,bankPdfPath:bankPath};
 const upload={source:'microsoft',name:'Invoice.pdf',data:invoice.toString('base64')};
 assert.equal((await api('/imports/tc',upload,cookie,'wrong')).status,403);
 assert.equal((await api('/imports/tc',{...upload,name:'../outside.pdf'})).status,400);
 assert.equal((await api('/imports/tc',{...upload,data:Buffer.from('fake').toString('base64')})).status,400);
 assert.equal((await api('/imports/tc',upload)).status,201);
 const sourceState=await(await api('/sources/tc')).json();assert.equal(sourceState.imports.length,1);assert.ok(sourceState.sources.every(s=>s.automatic===false));assert.equal(sourceState.imports[0].path,undefined);
 assert.equal((await api('/months',{...request,folderUrl:'javascript:alert(1)'})).status,400);
 assert.equal((await api('/months',request)).status,200);
 assert.equal((await(await api('/months?companyId=tc')).json()).months[0].month,'2026-10');
 assert.equal((await(await api('/jobs?companyId=tc')).json()).jobs.length,0);
 const [a,b]=await Promise.all([api('/jobs',request),api('/jobs',request)]);assert.equal(a.status,202);const job=await a.json();assert.equal((await b.json()).id,job.id);
 // Real subprocess, real HTTP transport, synthetic documents and no Microsoft credentials.
 const configPath=path.join(tmp,'runner-config.json');await fsp.writeFile(configPath,JSON.stringify({...config,mode:'local'}));
 child=spawn(process.execPath,['src/fibu/runner.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,FIBU_CONFIG_PATH:configPath,FIBU_PORTAL_URL:base,FIBU_RUNNER_DB:path.join(tmp,'runner.db'),FIBU_RUNNER_COMPANY:'tc'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});
 async function finished(){const deadline=Date.now()+20000;while(Date.now()<deadline){const j=await(await api('/jobs/'+job.id)).json();if(!['queued','running'].includes(j.state))return j;await new Promise(r=>setTimeout(r,100));}throw Error('Runner did not finish: '+output);}
 let result=await finished();assert.equal(result.state,'partial');assert.equal(result.transactions[0].status,'matched');assert.ok(result.remoteFiles.marked);
 assert.equal((await(await api('/companies')).json()).companies.find(c=>c.id==='tc').runnerOnline,true);
 const marked=await api('/jobs/'+job.id+'/files/marked');assert.equal(marked.status,200);assert.equal((await pdf.extract(await marked.arrayBuffer())).text,(await pdf.extract(bank)).text);
 assert.equal(hash(await fsp.readFile(bankPath)),hash(bank));
 assert.equal(result.documents[0].portalImport.source,'microsoft');
 const review={companyName:company.documentCompanyName,supplier:'Microsoft',invoice:'G194101447',amount:136.45,currency:'EUR',reason:'Betrag und Firma am Original geprüft',confirmOriginal:true};
 assert.equal((await api('/jobs/'+job.id+'/documents/'+result.documents[0].id+'/verify',{...review,companyName:'AC Immo Invest GmbH'})).status,400);
 assert.equal((await api('/jobs/'+job.id+'/documents/'+result.documents[0].id+'/verify',review)).status,202);
 result=await finished();assert.equal(result.documents[0].manualVerification.amount,136.45);assert.equal(result.documents[0].requiresReview,false);
 const other=await login('other@example.invalid');assert.equal((await api('/jobs/'+job.id,undefined,other.cookie)).status,200);assert.equal((await api('/jobs/'+job.id+'/files/marked',undefined,other.cookie)).status,200);
 const undo=await api('/jobs/'+job.id+'/assign',{transactionId:result.transactions[0].id,documentId:null,reason:'Synthetischer Test der Aufhebung'});assert.equal(undo.status,202);
 result=await finished();assert.equal(result.transactions[0].status,'missing');assert.equal(result.transactions[0].color,null);assert.equal(result.transactions[0].manualDecision,'unmatched');
 assert.equal((await api('/jobs/'+job.id+'/month',{action:'close'})).status,409);
 // A malicious path is queued but rejected on the execution machine before document writes.
 const bad=await(await api('/jobs',{...request,bankPdfPath:path.join(tmp,'outside.pdf')})).json();
 const deadline=Date.now()+10000;let rejected;while(Date.now()<deadline){rejected=await(await api('/jobs/'+bad.id)).json();if(!['queued','running'].includes(rejected.state))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(rejected.state,'failed');assert.ok(rejected.issues.length);
 company.enabled=false;company.allowedUsers=['pilot@example.invalid'];
 assert.equal((await api('/jobs',request)).status,403);
 const disabledState=(await(await api('/companies')).json()).companies.find(c=>c.id==='tc');assert.equal(disabledState.enabled,false);assert.equal(disabledState.canConnect,true);
 assert.equal((await api('/microsoft/tc/connect',{})).status,200);
 assert.equal((await api('/microsoft/tc/connect',{},other.cookie,other.csrfToken)).status,200);
 company.enabled=true;config.mode='local';
 // A late supplier invoice can be attached to a finished job without another mail/OCR full run.
 const urbanPdf=await fixture(['TestConsulting CC GmbH','Rechnungssteller: Urban Sports GmbH','Rechnungsnummer: USC-123456','Gesamtbetrag: 99,80 EUR']);
 company.allowedUsers=['pilot@example.invalid','other@example.invalid'];
 const lateUpload={source:'urban_sports_club',name:'Urban_Invoice.pdf',data:urbanPdf.toString('base64'),jobId:job.id};
 // The second authenticated account may attach receipts to the shared job.
 assert.equal((await api('/imports/tc',{...lateUpload,name:'Bank.pdf',data:bank.toString('base64')})).status,400);
 const beforeImport=await(await api('/jobs/'+job.id)).json(),attachedResponse=await api('/imports/tc',lateUpload,other.cookie,other.csrfToken);assert.equal(attachedResponse.status,201);
 const attachedResult=await attachedResponse.json();assert.equal(attachedResult.status,'attached_unassigned');assert.equal(attachedResult.jobId,job.id);const attachedFile=await api('/jobs/'+job.id+'/files/'+attachedResult.documentId);assert.equal(attachedFile.status,200);assert.equal(hash(Buffer.from(await attachedFile.arrayBuffer())),hash(urbanPdf));
 const afterImport=await(await api('/jobs/'+job.id)).json();assert.equal(afterImport.documents.length,beforeImport.documents.length+1);assert.equal(afterImport.transactions[0].status,beforeImport.transactions[0].status);assert.equal(afterImport.documents.find(d=>d.id===attachedResult.documentId).portalImport.source,'urban_sports_club');
 const sourceCatalog=await(await api('/sources/tc')).json();assert.equal(sourceCatalog.sources.find(s=>s.id==='urban_sports_club').url,'https://portal.urbansportsclub.com/login');
 const importStore=require('../src/fibu/store').createStore(db),savedMonth=importStore.month(job.owner,'tc',job.month,job.folderId);importStore.putMonth(job.owner,'tc',job.month,savedMonth||{},true,job.folderId);
 assert.equal((await api('/imports/tc',lateUpload)).status,409);importStore.putMonth(job.owner,'tc',job.month,savedMonth||{},false,job.folderId);
 const localReview=await api('/jobs/'+job.id+'/documents/'+result.documents[0].id+'/verify',review);assert.equal(localReview.status,200);
 const locallyReviewed=await localReview.json();assert.equal(locallyReviewed.documents[0].manualVerification.checkedBy,job.owner);
 const report=JSON.parse(await fsp.readFile(locallyReviewed.reportPath,'utf8'));assert.ok(report.events.some(e=>e.documentHash===result.documents[0].hash));
});

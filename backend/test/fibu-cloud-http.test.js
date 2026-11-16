const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'astra-cloud-http-'));process.env.DB_PATH=path.join(tmp,'portal.db');
const {createApp}=require('../src/app'),{upsertUser}=require('../src/users'),db=require('../src/db');
let server;test.after(async()=>{if(server)await new Promise(r=>server.close(r));db.close();await fsp.rm(tmp,{recursive:true,force:true});});
test('Cloud-HTTP: OneDrive-Auswahl, manueller Start, Serverergebnis und Original ohne Windows-Dienst',async()=>{
 const {PDFDocument}=await import('../vendor/pdf-lib.mjs');async function pdf(lines){const d=await PDFDocument.create(),p=d.addPage([900,842]);lines.forEach((s,i)=>p.drawText(s,{x:30,y:790-i*25,size:11}));return Buffer.from(await d.save());}
 const bank=await pdf(['TestConsulting CC GmbH','DE02120300000000202051','Auszugszeitraum: 01.10.2026 bis 31.10.2026','12.10.2026 Microsoft | INV12345 -100,00 EUR']);
 const invoice=await pdf(['TestConsulting CC GmbH','Rechnungssteller: Microsoft','Rechnungsnummer: INV12345','Gesamtbetrag: 100,00 EUR']);
 const c={enabled:true,pilotMode:true,root:path.join(tmp,'server-data'),collectionFolder:'collection',accountHolder:'TestConsulting CC GmbH',documentCompanyName:'TestConsulting CC GmbH',iban:'DE02120300000000202051',allowedUsers:['pilot@example.invalid'],cloud:{rootPath:'Company',monthBasePath:'Fibu'}};
 const ms={configured:true,connected:()=>true,list:async()=>[],driveList:async()=>[{name:'Bank.pdf',file:true,size:bank.length},{name:'Invoice.pdf',file:true,size:invoice.length}],driveDownload:async(o,c,p)=>({bytes:p.endsWith('Bank.pdf')?bank:invoice,source:{id:p,eTag:'synthetic'}})};
 await upsertUser({email:'pilot@example.invalid',firstName:'Pilot',lastName:'Cloud',password:'synthetic-cloud-only!'});
 server=createApp({sessionSecret:'synthetic-only',fibu:{config:{mode:'cloud',companies:{tc:c}},ms}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'pilot@example.invalid',password:'synthetic-cloud-only!'})}),cookie=login.headers.get('set-cookie').split(';')[0],auth=await login.json();
 const api=(url,body)=>fetch(base+'/api/fibu'+url,{headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 assert.equal((await fetch(base+'/api/fibu/onedrive/tc')).status,401);assert.equal((await api('/onedrive/tc?path=../Other')).status,400);assert.equal((await api('/onedrive/immo')).status,403);
 assert.equal((await(await api('/onedrive/tc?path=Fibu/2026/10')).json()).entries.length,2);
 const params={companyId:'tc',month:'2026-10',monthFolderPath:'Belege/Oktober',bankPdfPath:'Bankarchiv/2026/10/Bank.pdf',bankDrivePath:true};
 assert.equal((await api('/months',params)).status,200);assert.equal((await(await api('/months?companyId=tc')).json()).months[0].storageMode,'cloud');
 assert.equal((await api('/jobs',{...params,bankPdfPath:'C:/Windows/private.pdf'})).status,400);
 assert.equal((await api('/months',{...params,bankPdfPath:'../Other/Bank.pdf'})).status,400);
 const started=await api('/jobs',params);assert.equal(started.status,202);const job=await started.json();let result;
 const until=Date.now()+15000;while(Date.now()<until){result=await(await api('/jobs/'+job.id)).json();if(!['queued','running'].includes(result.state))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(result.execution,'server');assert.equal(result.state,'completed');assert.equal(result.transactions[0].status,'matched');assert.ok(result.markedPdfPath);assert.equal(result.sourceMonthPath,'Belege/Oktober');
 const original=Buffer.from(await(await api('/jobs/'+job.id+'/files/original')).arrayBuffer());assert.deepEqual(original,bank);
 assert.ok(result.cloudSources.some(s=>s.path==='Bankarchiv/2026/10/Bank.pdf'));
 assert.equal((await api('/jobs/'+job.id+'/month',{action:'close'})).status,409);
 const rootParams={...params,monthFolderPath:'',bankPdfPath:'Bank.pdf',bankDrivePath:true};
 assert.equal((await api('/months',rootParams)).status,200);
 const rootStart=await api('/jobs',rootParams);assert.equal(rootStart.status,202);const rootJob=await rootStart.json();
 let rootResult;for(let n=0;n<100;n++){rootResult=await(await api('/jobs/'+rootJob.id)).json();if(!['queued','running'].includes(rootResult.state))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(rootResult.state,'completed');assert.ok(rootResult.cloudSources.some(s=>s.path==='Bank.pdf'));
 assert.ok((await(await api('/jobs?companyId=tc')).json()).jobs.some(j=>j.id===rootJob.id));
});

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
 let downloadRelease,downloadEntered;const entered=new Promise(r=>downloadEntered=r),gate=new Promise(r=>downloadRelease=r),originalDownload=ms.driveDownload;let downloads=0;ms.driveDownload=async(...args)=>{downloads++;if(downloads===1){downloadEntered();await gate;}return originalDownload(...args);};
 const started=await api('/jobs',params);assert.equal(started.status,202);const job=await started.json();let result;
 await entered;assert.equal((await fetch(base+'/api/fibu/jobs/'+job.id+'/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await fetch(base+'/api/fibu/jobs/'+job.id+'/pause',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await api('/jobs/'+job.id+'/pause',{})).status,200);downloadRelease();
 for(let i=0;i<100;i++){result=await(await api('/jobs/'+job.id)).json();if(result.paused)break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(result.paused,true);const pausedDownloads=downloads;await new Promise(r=>setTimeout(r,80));assert.equal(downloads,pausedDownloads);assert.equal((await api('/jobs/'+job.id+'/resume',{})).status,200);

 const until=Date.now()+15000;while(Date.now()<until){result=await(await api('/jobs/'+job.id)).json();if(!['queued','running'].includes(result.state))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(result.execution,'server');assert.equal(result.state,'completed');assert.equal(result.transactions[0].status,'matched');assert.ok(result.markedPdfPath);assert.equal(result.sourceMonthPath,'Belege/Oktober');
 const original=Buffer.from(await(await api('/jobs/'+job.id+'/files/original')).arrayBuffer());assert.deepEqual(original,bank);
 assert.ok(result.cloudSources.some(s=>s.path==='Bankarchiv/2026/10/Bank.pdf'));
 assert.equal(result.workProgress.percent,100);assert.equal(result.workProgress.stage,'done');assert.ok(result.workProgress.startedAt);
 assert.equal((await api('/jobs/'+job.id+'/month',{action:'close'})).status,409);
 const rootParams={...params,monthFolderPath:'',bankPdfPath:'Bank.pdf',bankDrivePath:true};
 assert.equal((await api('/months',rootParams)).status,200);
 const rootStart=await api('/jobs',rootParams);assert.equal(rootStart.status,202);const rootJob=await rootStart.json();
 let rootResult;for(let n=0;n<100;n++){rootResult=await(await api('/jobs/'+rootJob.id)).json();if(!['queued','running'].includes(rootResult.state))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(rootResult.state,'completed');assert.ok(rootResult.cloudSources.some(s=>s.path==='Bank.pdf'));
 assert.ok((await(await api('/jobs?companyId=tc')).json()).jobs.some(j=>j.id===rootJob.id));
 const createProfile=async label=>{const r=await api('/months',{...params,create:true,label});assert.equal(r.status,201);return r.json();};
 const first=await createProfile('Original'),second=await createProfile('Testlauf');assert.notEqual(first.id,second.id);
 assert.equal((await api('/months/'+second.id+'/name',{companyId:'tc',name:'   '})).status,400);
 assert.equal((await api('/months/unknown/name',{companyId:'tc',name:'Test'})).status,404);
 const renamed=await(await api('/months/'+second.id+'/name',{companyId:'tc',name:'  Mein eigener Oktober  '})).json();assert.equal(renamed.name,'Mein eigener Oktober');assert.equal(renamed.monthFolderPath,second.monthFolderPath);assert.equal(renamed.bankPdfPath,second.bankPdfPath);
 assert.equal((await(await api('/months?companyId=tc')).json()).months.find(m=>m.id===first.id).name,first.name);
 let profiles=(await(await api('/months?companyId=tc')).json()).months;assert.equal(profiles.length,3);assert.ok(profiles.some(m=>m.id==='2026-10'));
 assert.equal((await api('/months',{...second,monthFolderPath:'Belege/10_Test'})).status,200);
 profiles=(await(await api('/months?companyId=tc')).json()).months;assert.equal(profiles.find(m=>m.id===first.id).monthFolderPath,params.monthFolderPath);assert.equal(profiles.find(m=>m.id===second.id).monthFolderPath,'Belege/10_Test');
 assert.equal((await api('/jobs',{...params,folderId:'unknown-profile'})).status,404);
 assert.equal((await api('/jobs',{...params,folderId:second.id})).status,409);
 const profiled=await api('/jobs',{...params,folderId:first.id});assert.equal(profiled.status,202);const profiledJob=await profiled.json();let profiledResult;
 for(let n=0;n<100;n++){profiledResult=await(await api('/jobs/'+profiledJob.id)).json();if(!['queued','running'].includes(profiledResult.state))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(profiledResult.state,'completed');assert.equal(profiledResult.folderId,first.id);
 const store=require('../src/fibu/store').createStore(db);assert.equal(store.month(profiledResult.owner,'tc','2026-10',first.id).jobId,profiledJob.id);assert.equal(store.month(profiledResult.owner,'tc','2026-10').jobId,rootJob.id);assert.equal(store.month(profiledResult.owner,'tc','2026-10',second.id),null);
 const settings=await(await api('/settings/tc')).json();assert.equal(settings.pilotMode,true);assert.equal(settings.mailStorage,'privateServer');assert.equal(settings.mailbox,'epost@testconsulting.de');assert.equal(settings.iban,undefined);assert.equal((await api('/settings/immo')).status,403);
 assert.equal((await api('/months/unknown/remove',{companyId:'tc'})).status,404);assert.equal((await api('/months/'+first.id+'/remove',{companyId:'immo'})).status,403);
 assert.equal((await api('/months/'+first.id+'/remove',{companyId:'tc'})).status,200);
 const hidden=await(await api('/months?companyId=tc')).json();assert.equal(hidden.months.some(m=>m.id===first.id),false);assert.equal(hidden.removed.some(m=>m.id===first.id),true);
 assert.equal((await api('/jobs',{...params,folderId:first.id})).status,404);
 assert.deepEqual(Buffer.from(await(await api('/jobs/'+profiledJob.id+'/files/original')).arrayBuffer()),bank);assert.ok(await fsp.stat(profiledResult.markedPdfPath));
 assert.equal((await api('/months/'+first.id+'/restore',{companyId:'tc'})).status,200);const restored=(await(await api('/months?companyId=tc')).json()).months.find(m=>m.id===first.id);assert.equal(restored.bankPdfPath,first.bankPdfPath);assert.equal(restored.name,first.name);
 const active=store.enqueue(profiledResult.owner,{companyId:'tc',month:'2026-10',folderId:first.id});assert.equal((await api('/months/'+first.id+'/remove',{companyId:'tc'})).status,409);store.save(active,'cancelled');
 await upsertUser({email:'partner@example.invalid',firstName:'Partner',lastName:'Shared',password:'synthetic-partner-only!'});const secondLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'partner@example.invalid',password:'synthetic-partner-only!'})}),secondCookie=secondLogin.headers.get('set-cookie').split(';')[0],secondAuth=await secondLogin.json();
 const secondApi=(url,body)=>fetch(base+'/api/fibu'+url,{headers:{Cookie:secondCookie,'Content-Type':'application/json','X-CSRF-Token':secondAuth.csrfToken},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 assert.equal((await secondApi('/jobs/'+profiledJob.id)).status,200);assert.equal((await secondApi('/jobs/'+profiledJob.id+'/files/original')).status,200);assert.equal((await secondApi('/months?companyId=tc')).status,200);
 assert.equal((await secondApi('/months/'+first.id+'/completion',{companyId:'tc',complete:true})).status,200);assert.equal((await(await api('/months?companyId=tc')).json()).months.find(m=>m.id===first.id).completed,true);assert.equal((await api('/months/'+first.id+'/completion',{companyId:'tc',complete:false})).status,200);assert.equal((await(await secondApi('/months?companyId=tc')).json()).months.find(m=>m.id===first.id).completed,false);
 const ruleConfig=await(await secondApi('/rules/tc')).json();assert.equal(ruleConfig.rules.length,8);const savedRules=await secondApi('/rules/tc',{...ruleConfig,rules:ruleConfig.rules.map(r=>({...r,note:'Gemeinsame Konfiguration'}))});assert.equal(savedRules.status,200);assert.equal((await(await api('/rules/tc')).json()).version,1);assert.equal((await api('/rules/tc',ruleConfig)).status,409);assert.equal((await fetch(base+'/api/fibu/rules/tc')).status,401);
 let driveOwner;ms.driveFolder=async(o,co,p)=>{driveOwner=o;return {webUrl:null};};assert.equal((await secondApi('/onedrive/tc?path=Fibu/2026/10')).status,200);assert.equal(driveOwner,profiledJob.owner);
 const busy=store.enqueue(profiledJob.owner,{companyId:'tc',month:'2026-10',folderId:first.id});assert.equal((await secondApi('/months/'+first.id+'/completion',{companyId:'tc',complete:true})).status,409);store.save(busy,'cancelled');

 assert.equal((await secondApi('/months/'+first.id+'/completion',{companyId:'tc',complete:true})).status,200);const secondStart=await secondApi('/jobs',{...params,folderId:first.id});assert.equal(secondStart.status,202);const secondJob=await secondStart.json();assert.equal(secondJob.owner,profiledJob.owner);assert.equal((await(await api('/months?companyId=tc')).json()).months.find(m=>m.id===first.id).completed,false);let secondResult;for(let i=0;i<100;i++){secondResult=await(await api('/jobs/'+secondJob.id)).json();if(!['queued','running'].includes(secondResult.state))break;await new Promise(r=>setTimeout(r,100));}assert.equal(secondResult.state,'completed');

});

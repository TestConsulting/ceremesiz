const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {tokenVault}=require('../src/fibu/token-vault');
const {oneDrive,cleanPath}=require('../src/fibu/onedrive');
test('Microsoft-Verbindung bleibt verschlüsselt, mandantengebunden und nach Neustart verwendbar',async()=>{
 const db=new Database(':memory:'),key=crypto.randomBytes(32).toString('base64');
 try{
  const vault=tokenVault(db,key);vault.put(1,'tc',{access_token:'synthetic-private-token',refresh_token:'synthetic-refresh',expiresAt:Date.now()+3600000});
  const encrypted=db.prepare('SELECT payload FROM fibu_microsoft_tokens').get().payload;assert.ok(!encrypted.includes('synthetic-private-token'));assert.equal(tokenVault(db,key).get(1,'tc').refresh_token,'synthetic-refresh');assert.equal(vault.get(2,'tc'),null);
  db.prepare('INSERT INTO fibu_microsoft_tokens VALUES(?,?,?)').run(2,'tc',encrypted);assert.throws(()=>vault.get(2,'tc'));assert.throws(()=>tokenVault(db,crypto.randomBytes(32).toString('base64')).get(1,'tc'));
  const {microsoft}=require('../src/fibu/microsoft'),ms=microsoft({mode:'cloud',microsoft:{tenantId:'synthetic',clientId:'synthetic'}},{vault});assert.equal(ms.connected(1,'tc'),true);ms.disconnect(1,'tc');assert.equal(vault.get(1,'tc'),null);
 }finally{db.close();}
});
test('OneDrive lädt nur unter konfigurierter Wurzel, ohne Bearer am Downloadziel; Revisionen werden geprüft',async()=>{
 const original=global.fetch,bytes=Buffer.from('synthetic-content');let revision='etag-1',calls=0;
 const item=()=>({id:'file1',name:'Beleg.pdf',size:bytes.length,eTag:revision,file:{hashes:{sha1Hash:crypto.createHash('sha1').update(bytes).digest('hex')}},'@microsoft.graph.downloadUrl':'https://tenant.sharepoint.com/download?synthetic'});
 const drive=oneDrive({config:{companies:{tc:{cloud:{rootPath:'Company'}}}},graph:async(o,c,route)=>{assert.ok(route.startsWith('me/drive/root:/Company/'));calls++;return item();}});
 try{
  global.fetch=async(url,options)=>{assert.equal(options.headers,undefined);assert.equal(options.redirect,'error');return new Response(bytes);};
  const result=await drive.download(1,'tc','2026/10/Beleg.pdf');assert.equal(result.bytes.toString(),bytes.toString());assert.equal(calls,2);
  for(const p of ['../Other','2026/../Other','/Other','C:\\Other','a//b'])assert.throws(()=>cleanPath(p));
  global.fetch=async()=>{revision='etag-2';return new Response(bytes);};await assert.rejects(drive.download(1,'tc','2026/10/Beleg.pdf'),/verändert/);
  const bad=oneDrive({config:{companies:{tc:{cloud:{rootPath:'Company'}}}},graph:async()=>({...item(),'@microsoft.graph.downloadUrl':'https://evil.invalid/steal'})});await assert.rejects(bad.download(1,'tc','doc.pdf'),/Downloadziel/);
  let attempts=0;global.fetch=async()=>++attempts===1?new Response('retry',{status:429,headers:{'retry-after':'1'}}):new Response(bytes);await drive.download(1,'tc','2026/10/Beleg.pdf');assert.equal(attempts,2);
  attempts=0;global.fetch=async()=>{attempts++;return new Response('blocked',{status:403});};await assert.rejects(drive.download(1,'tc','2026/10/Beleg.pdf'),/HTTP 403/);assert.equal(attempts,1);
 }finally{global.fetch=original;}
});
test('Server verarbeitet OneDrive-Snapshots ohne Windows-Rechner; Bank und Firma werden vor Belegablage geprüft',async()=>{
 const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),'astra-cloud-')),db=new Database(':memory:');
 const {createStore}=require('../src/fibu/store'),{engine}=require('../src/fibu/engine'),{cloudWorker}=require('../src/fibu/cloud');
 try{
  const {PDFDocument}=await import('../vendor/pdf-lib.mjs');async function pdf(lines){const d=await PDFDocument.create(),p=d.addPage([900,842]);lines.forEach((s,i)=>p.drawText(s,{x:30,y:790-i*25,size:11}));return Buffer.from(await d.save());}
  const bank=await pdf(['TestConsulting CC GmbH','DE02120300000000202051','Auszugszeitraum: 01.10.2026 bis 31.10.2026','12.10.2026 Microsoft | INV12345 -100,00 EUR']);
  const invoice=await pdf(['TestConsulting CC GmbH','Rechnungssteller: Microsoft','Rechnungsnummer: INV12345','Gesamtbetrag: 100,00 EUR']);
  const c={root:tmp,pilotMode:true,accountHolder:'TestConsulting CC GmbH',documentCompanyName:'TestConsulting CC GmbH',iban:'DE02120300000000202051',cloud:{rootPath:'Company',monthBasePath:'Fibu'}};
  const listed=[];let downloads=0;const ms={connected:()=>true,list:async()=>[],driveList:async(o,c,p)=>{listed.push(p);if(p==='Fibu/2026/10')return [{file:true,name:'Bank.pdf',size:bank.length},{file:true,name:'Bank_Astra.pdf',size:bank.length},{file:true,name:'Restricted.pdf',size:1}];if(p==='Fibu/2026/09')return [{folder:true,name:'Rechnungsausgang'}];if(p==='Fibu/2026/09/Rechnungsausgang')return [{file:true,name:'Invoice_Astra.pdf',size:invoice.length}];throw Object.assign(Error('Missing month'),{graphStatus:404});},driveDownload:async(o,c,p)=>{downloads++;if(p.endsWith('Restricted.pdf'))throw Object.assign(Error('Download HTTP 403'),{status:422});return {bytes:p.endsWith('Bank.pdf')?bank:invoice,source:{id:p,eTag:'synthetic'}};}};
  const store=createStore(db),worker=engine({store,config:{mode:'cloud'},ms}),cloud=cloudWorker({store,worker,ms});
  const job=store.enqueue(1,{companyId:'tc',month:'2026-10',sourceMonthPath:'Fibu/2026/10',sourceBankName:'Bank.pdf'});
  await Promise.all([cloud.run(job.id,1,c),cloud.run(job.id,1,c)]);const result=store.get(1,job.id);assert.equal(downloads,3);assert.equal(result.state,'partial');assert.match(result.issues.join(' '),/Restricted.pdf/);assert.equal(result.execution,'server');assert.deepEqual(listed,['Fibu/2026/10','Fibu/2026/09','Fibu/2026/09/Rechnungsausgang','Fibu/2026/08','Fibu/2026/07']);assert.equal(result.searchScope.lookbackMonths,3);assert.equal(result.transactions[0].status,'matched');assert.equal(result.cloudSources.length,2);assert.equal(await require('../src/fibu/core').inside(tmp,result.markedPdfPath),result.markedPdfPath);assert.equal(require('../src/fibu/core').hash(await fsp.readFile(result.bankPdfPath)),require('../src/fibu/core').hash(bank));
  c.iban='DE99999999999999999999';const wrong=store.enqueue(1,{companyId:'tc',month:'2026-10',sourceMonthPath:'Fibu/2026/10',sourceBankName:'Bank.pdf'});await cloud.run(wrong.id,1,c);assert.equal(store.get(1,wrong.id).state,'waiting_for_user');assert.equal(store.get(1,wrong.id).markedPdfPath,undefined);assert.equal(downloads,4);
 }finally{db.close();await fsp.rm(tmp,{recursive:true,force:true});}
});
test('Importoriginal bleibt erhalten; ältere verschobene Imports werden hashgeprüft wiederhergestellt und fehlende optionale Imports stoppen den Lauf nicht',async()=>{
 const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),'astra-import-recovery-')),db=new Database(':memory:');
 try{
  const {createStore}=require('../src/fibu/store'),{engine}=require('../src/fibu/engine'),{cloudWorker}=require('../src/fibu/cloud'),{hash}=require('../src/fibu/core'),pdfReader=require('../src/fibu/pdf'),{PDFDocument}=await import('../vendor/pdf-lib.mjs');
  async function pdf(lines){const d=await PDFDocument.create(),p=d.addPage([900,842]);lines.forEach((s,i)=>p.drawText(s,{x:30,y:790-i*25,size:11}));return Buffer.from(await d.save());}
  const bank=await pdf(['TestConsulting CC GmbH','DE02120300000000202051','Auszugszeitraum: 01.10.2026 bis 31.10.2026','12.10.2026 Vendor | INV998877 -100,00 EUR']),invoice=await pdf(['TestConsulting CC GmbH','Rechnungssteller: Vendor','Rechnungsnummer: INV998877','Gesamtbetrag: 100,00 EUR']);
  const folder=path.join(tmp,'1','previous','2026','10'),imports=path.join(tmp,'1','imports');await fsp.mkdir(folder,{recursive:true});await fsp.mkdir(imports,{recursive:true});await fsp.writeFile(path.join(folder,'Bank.pdf'),bank);const importPath=path.join(imports,'Portal_urban_sports.pdf');await fsp.writeFile(importPath,invoice);
  const c={root:tmp,pilotMode:true,accountHolder:'TestConsulting CC GmbH',documentCompanyName:'TestConsulting CC GmbH',iban:'DE02120300000000202051',cloud:{rootPath:'Company'}},store=createStore(db),record={hash:hash(invoice),path:importPath,source:'urban_sports_club',originalName:'Invoice.pdf'};store.putImport(1,'tc',record.hash,record);
  const ms={connected:()=>true,list:async()=>[],driveList:async()=>[{file:true,name:'Bank.pdf',size:bank.length}],driveDownload:async()=>({bytes:bank,source:{id:'bank',eTag:'synthetic'}})},worker=engine({store,config:{mode:'cloud'},ms}),cloud=cloudWorker({store,worker,ms});
  const checked=await worker.validate(c,{monthFolderPath:folder,bankPdfPath:path.join(folder,'Bank.pdf')}),prior=store.enqueue(1,{companyId:'tc',...checked}),document={id:record.hash,hash:record.hash,path:importPath,name:'Invoice.pdf',...pdfReader.receiptMetadata(await pdfReader.extract(invoice),c),source:'import',portalImport:record};prior.documents=[document];prior.transactions=checked.transactions;await worker.assign(prior,prior.transactions[0],document,c);store.save(prior,'partial');assert.equal(hash(await fsp.readFile(importPath)),record.hash);
  // Reproduce the old version: only the verified copy in the previous job survives.
  await fsp.unlink(importPath);const next=store.enqueue(1,{companyId:'tc',month:'2026-10',sourceMonthPath:'Fibu/2026/10',sourceBankName:'Bank.pdf'});await cloud.run(next.id,1,c);const result=store.get(1,next.id);assert.equal(result.transactions[0].status,'matched');assert.equal(hash(await fsp.readFile(store.imports(1,'tc')[0].path)),record.hash);assert.ok(result.events.some(e=>/hashgeprüfter Kopie wiederhergestellt/.test(e.message)));
  const otherInvoice=await pdf(['TestConsulting CC GmbH','Rechnungssteller: Other','Rechnungsnummer: OTHER12345','Gesamtbetrag: 50,00 EUR']),missingHash=hash(otherInvoice),otherPath=path.join(tmp,'2','Other.pdf');await fsp.mkdir(path.dirname(otherPath),{recursive:true});await fsp.writeFile(otherPath,otherInvoice);const otherJob=store.enqueue(2,{companyId:'tc',month:'2026-09'});otherJob.documents=[{id:missingHash,hash:missingHash,path:otherPath}];store.save(otherJob,'partial');store.putImport(1,'tc',missingHash,{hash:missingHash,path:path.join(imports,'Missing.pdf'),source:'urban_sports_club',originalName:'Missing.pdf'});
  const third=store.enqueue(1,{companyId:'tc',month:'2026-10',sourceMonthPath:'Fibu/2026/10',sourceBankName:'Bank.pdf'});await cloud.run(third.id,1,c);const partial=store.get(1,third.id);assert.equal(partial.transactions[0].status,'matched');assert.equal(partial.state,'partial');assert.ok(partial.issues.some(i=>/Missing.pdf.*keine hashgeprüfte Kopie/.test(i)));assert.equal(store.imports(1,'tc').find(i=>i.hash===missingHash).path,path.join(imports,'Missing.pdf'));
 }finally{db.close();await fsp.rm(tmp,{recursive:true,force:true});}
});

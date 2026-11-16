const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {bankSync}=require('../src/fibu/bank-sync'),{hash}=require('../src/fibu/core');
test('OneDrive-Bank wird erst nach verifizierter Originalsicherung ersetzt; Wiederholung nutzt unveränderte Quelle und sperrt Fremdänderungen',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'astra-bank-sync-'));
 try{
  const original=Buffer.from('%PDF-original'),marked=Buffer.from('%PDF-colours'),remote=new Map([['2026/10_Test/Bank.pdf',{bytes:original,eTag:'v1'}]]),writes=[];
  const missing=()=>Object.assign(Error('missing'),{graphStatus:404});let version=1;
  const drive={ensureBackupFolder:async(o,c,p)=>p+'/_ASTRA_Originale',download:async(o,c,p)=>{const d=remote.get(p);if(!d)throw missing();return {bytes:d.bytes,source:{eTag:d.eTag}};},putPdf:async(o,c,p,bytes,expected)=>{const old=remote.get(p);assert.ok(expected?old.eTag===expected:!old);writes.push(p);const d={bytes,eTag:'v'+(++version)};remote.set(p,d);return {eTag:d.eTag,webUrl:'https://tenant.sharepoint.com/bank'};}};
  const jobs=[],store={list:()=>jobs,get:(o,id)=>jobs.find(j=>j.id===id),save:()=>{}};const sync=bankSync(drive,()=>true);
  const job={id:'first',owner:1,companyId:'tc',state:'running',events:[],issues:[],bankPdfPath:path.join(root,'Bank.pdf'),markedPdfPath:path.join(root,'Marked.pdf')};jobs.unshift(job);
  const bytes=await sync.source(job,'2026/10_Test/Bank.pdf',original,{eTag:'v1'},store);await fs.writeFile(job.bankPdfPath,bytes);await fs.writeFile(job.markedPdfPath,marked);
  await sync.publish(job,{root},store);assert.equal(job.cloudPublished.verified,true);assert.deepEqual(remote.get(job.bankSource.path).bytes,marked);assert.deepEqual(remote.get(job.bankSource.backupPath).bytes,original);assert.equal(writes[0],job.bankSource.backupPath);
  const next={...job,id:'second',cloudPublished:undefined,bankSource:undefined};jobs.unshift(next);
  assert.deepEqual(await sync.source(next,job.bankSource.path,marked,{eTag:job.cloudPublished.eTag},store),original);
  remote.get(job.bankSource.path).eTag='external-change';await assert.rejects(sync.publish(next,{root},store),/inzwischen geändert/);assert.equal(writes.length,2);
  const denied=bankSync(drive,()=>false);next.issues=[];await denied.publish(next,{root},store);assert.match(next.issues[0],/Schreibzugriff/);assert.equal(writes.length,2);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

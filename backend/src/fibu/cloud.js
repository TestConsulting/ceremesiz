const fs=require('node:fs/promises'),path=require('node:path');
const {inside,monthFromFolder,writeVerified,fail}=require('./core');
const {cleanPath}=require('./onedrive');
function cloudWorker({store,worker,ms}){
 const running=new Set();
 async function run(id,owner,c){
  if(running.has(id))return;running.add(id);
  let job=store.get(owner,id);
  try{
   job.state='running';job.progress='OneDrive-Dateien werden direkt auf dem Server geladen.';store.save(job);
   if(!ms.connected(owner,job.companyId))fail('Microsoft für OneDrive und E-Post verbinden.',409);
   cleanPath(job.sourceMonthPath);const month=monthFromFolder(job.sourceMonthPath);
   if(typeof job.sourceBankName!=='string'||/[\\/\x00-\x1f]/.test(job.sourceBankName)||! /\.pdf$/i.test(job.sourceBankName)||/_Astra(?:_|\.)/i.test(job.sourceBankName))fail('Original-Bank-PDF wählen.',400);
   await fs.mkdir(c.root,{recursive:true,mode:0o700});
   const ownerRoot=path.join(c.root,String(owner));await fs.mkdir(ownerRoot,{recursive:true,mode:0o700});await inside(c.root,ownerRoot,'directory');
   const local={...c,root:ownerRoot,collectionFolder:path.join(ownerRoot,'collection')};
   const folder=path.join(ownerRoot,'jobs',id,...month.split('-'));await fs.mkdir(folder,{recursive:true,mode:0o700});await fs.mkdir(local.collectionFolder,{recursive:true,mode:0o700});
   const entries=await ms.driveList(owner,job.companyId,job.sourceMonthPath);
   const bank=entries.find(d=>d.file&&d.name===job.sourceBankName);if(!bank)fail('Bank-PDF fehlt im gewählten OneDrive-Monatsordner.');
   const snapshots=[];let total=0;
   async function copy(entry,relative,destination){
    if(store.get(owner,id)?.cancelRequested)fail('Vor Verarbeitung abgebrochen.',409);
    if(/[\\/\x00-\x1f]/.test(entry.name)||entry.name==='.'||entry.name==='..')fail('Ungültiger OneDrive-Dateiname.');
    total+=entry.size;if(total>100*1024*1024)fail('OneDrive-Quellen über 100 MB. Monat/Sammelordner eingrenzen.');
    const {bytes,source}=await ms.driveDownload(owner,job.companyId,relative+'/'+entry.name);
    const saved=await writeVerified(destination,entry.name,bytes);snapshots.push({...source,path:relative+'/'+entry.name});return saved;
   }
   job.monthFolderPath=folder;job.bankPdfPath=await copy(bank,job.sourceMonthPath,folder);
   const checked=await worker.validate(local,job);job.bankHash=checked.bankHash;job.transactions=checked.transactions;job.controls=checked.controls||null;job.progress='OneDrive-Bankkonto und Auszugszeitraum geprüft.';store.save(job);
   async function copyReceipt(entry,relative,destination){try{await copy(entry,relative,destination);}catch(e){if(store.get(owner,id)?.cancelRequested)throw e;job.issues.push('OneDrive-Beleg '+entry.name+': '+(e.status?e.message:'Datei nicht lesbar. Manuell prüfen.'));}}
   const markedBankPrefix=path.parse(bank.name).name+'_Astra';
   const supported=d=>d.file&&/\.(pdf|png|jpe?g)$/i.test(d.name)&&!d.name.toLowerCase().startsWith(markedBankPrefix.toLowerCase())&&!/ASTRA_Pruefbericht/i.test(d.name);
   for(const entry of entries.filter(d=>supported(d)&&d.name!==bank.name))await copyReceipt(entry,job.sourceMonthPath,folder);
   if(c.cloud.collectionPath){cleanPath(c.cloud.collectionPath);try{const collected=await ms.driveList(owner,job.companyId,c.cloud.collectionPath);for(const entry of collected.filter(supported))await copyReceipt(entry,c.cloud.collectionPath,local.collectionFolder);}catch(e){if(store.get(owner,id)?.cancelRequested)throw e;job.issues.push('OneDrive-Sammelordner: '+(e.status?e.message:'Quelle nicht vollständig lesbar.'));}}
   for(const imported of store.imports(owner,job.companyId)){
    const src=await inside(c.root,imported.path),bytes=await fs.readFile(src);await writeVerified(local.collectionFolder,path.basename(src),bytes);
   }
   job.cloudSources=snapshots;job.execution='server';store.save(job);await worker.run(id,owner,local);
  }catch(e){job=store.get(owner,id);job.issues.push(e.status?e.message:'OneDrive-Verarbeitung fehlgeschlagen. Verbindung und Berechtigungen prüfen.');job.progress='Serverprüfung angehalten';store.save(job,job.cancelRequested?'cancelled':'waiting_for_user');}
  finally{running.delete(id);}
 }
 return {run};
}
module.exports={cloudWorker};

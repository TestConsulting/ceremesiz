const fs=require('node:fs/promises'),path=require('node:path');
const {inside,writeVerified,fail,hash}=require('./core');
const {cleanPath}=require('./onedrive');
const {advance}=require('./progress');
function cloudWorker({store,worker,ms}){
 const running=new Set();
 async function run(id,owner,c){
  if(running.has(id))return;running.add(id);
  let job=store.get(owner,id);
  try{
   advance(job,store,'download');
   job.state='running';job.progress='OneDrive-Dateien werden direkt auf dem Server geladen.';store.save(job);
   if(!ms.connected(owner,job.companyId))fail('Microsoft für OneDrive und E-Post verbinden.',409);
   cleanPath(job.sourceMonthPath,{empty:true});const month=job.month;if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))fail('Gültigen Prüfmonat wählen.',400);
   cleanPath(job.sourceBankName);
   if(! /\.pdf$/i.test(job.sourceBankName)||/_Astra(?:_|\.)/i.test(path.posix.basename(job.sourceBankName)))fail('Original-Bank-PDF wählen.',400);
   await fs.mkdir(c.root,{recursive:true,mode:0o700});
   const ownerRoot=path.join(c.root,String(owner));await fs.mkdir(ownerRoot,{recursive:true,mode:0o700});await inside(c.root,ownerRoot,'directory');
   const local={...c,root:ownerRoot,collectionFolder:path.join(ownerRoot,'collection')};
   const folder=path.join(ownerRoot,'jobs',id,...month.split('-'));await fs.mkdir(folder,{recursive:true,mode:0o700});await fs.mkdir(local.collectionFolder,{recursive:true,mode:0o700});
   const entries=await ms.driveList(owner,job.companyId,job.sourceMonthPath);
   const bankPath=(job.sourceBankIsDrivePath||job.sourceBankName.includes('/'))?job.sourceBankName:job.sourceMonthPath+'/'+job.sourceBankName;
   const bankFolder=path.posix.dirname(bankPath)==='.'?'':path.posix.dirname(bankPath);
   const bankEntries=bankFolder===job.sourceMonthPath?entries:await ms.driveList(owner,job.companyId,bankFolder);
   const bank=bankEntries.find(d=>d.file&&d.name===path.posix.basename(bankPath));if(!bank)fail('Bank-PDF fehlt im gewählten OneDrive-Ordner.');
   const markedBankPrefix=path.parse(bank.name).name+'_Astra';
   const supported=d=>d.file&&/\.(pdf|png|jpe?g)$/i.test(d.name)&&!d.name.toLowerCase().startsWith(markedBankPrefix.toLowerCase())&&!/ASTRA_Pruefbericht/i.test(d.name);
   const snapshots=[];let total=0,downloaded=0,downloadTotal=entries.filter(d=>supported(d)&&d.name!==bank.name).length+1;
   async function copy(entry,relative,destination){
    if(store.get(owner,id)?.cancelRequested)fail('Vor Verarbeitung abgebrochen.',409);
    if(/[\\/\x00-\x1f]/.test(entry.name)||entry.name==='.'||entry.name==='..')fail('Ungültiger OneDrive-Dateiname.');
    total+=entry.size;if(total>100*1024*1024)fail('OneDrive-Quellen über 100 MB. Monat/Sammelordner eingrenzen.');
    advance(job,store,'download',downloaded++,downloadTotal);
    const sourcePath=(relative?relative+'/':'')+entry.name;
    let {bytes,source}=await ms.driveDownload(owner,job.companyId,sourcePath);
    if(entry===bank&&ms.bankSource)bytes=await ms.bankSource(job,sourcePath,bytes,source,store);
    const saved=await writeVerified(destination,entry.name,bytes);snapshots.push({...source,path:sourcePath});return saved;
   }
   job.monthFolderPath=folder;job.bankPdfPath=await copy(bank,bankFolder,folder);
   const checked=await worker.validate(local,job);job.bankHash=checked.bankHash;job.transactions=checked.transactions;job.controls=checked.controls||null;job.progress='OneDrive-Bankkonto und Auszugszeitraum geprüft.';store.save(job);
   async function copyReceipt(entry,relative,destination){try{await copy(entry,relative,destination);}catch(e){if(store.get(owner,id)?.cancelRequested)throw e;job.issues.push('OneDrive-Beleg '+entry.name+': '+(e.status?e.message:'Datei nicht lesbar. Manuell prüfen.'));}}
   const plan=[];let foldersRead=0;
   async function collect(relative,destination,known,depth=0){
    if(store.get(owner,id)?.cancelRequested)fail('Vor Verarbeitung abgebrochen.',409);
    if(++foldersRead>80)fail('Mehr als 80 Quellordner. Suche eingrenzen.');
    const children=known||await ms.driveList(owner,job.companyId,relative);
    for(const entry of children){
     if(entry.folder&&entry.name.toLowerCase()==='nicht zugewiesene belege')continue;
     if(entry.folder&&depth>=8)fail('Belegsuche auf acht Ordnerebenen begrenzt. Suche eingrenzen.');
     if(entry.folder&&depth<8&&!/^_(?:ASTRA_Originale|Vorversionen)|^Backup/i.test(entry.name)){cleanPath(entry.name);await collect((relative?relative+'/':'')+entry.name,destination,null,depth+1);}
     else if(supported(entry)&&entry.name!==bank.name&&!/^(?:Sparkasse_\d{2}[._]|GK_|Pruefprotokoll)/i.test(entry.name)){plan.push({entry,relative,destination});if(plan.length>500)fail('Mehr als 500 Belege. Suche eingrenzen.');}
    }
   }
   await collect(job.sourceMonthPath,folder,entries);
   if(c.cloud.monthBasePath){
    const date=new Date(month+'-01T12:00:00Z');
    for(let back=1;back<=3;back++){
     const d=new Date(date);d.setUTCMonth(d.getUTCMonth()-back);const relative=c.cloud.monthBasePath+'/'+d.getUTCFullYear()+'/'+String(d.getUTCMonth()+1).padStart(2,'0');
     if(relative===job.sourceMonthPath)continue;
     try{await collect(relative,local.collectionFolder);}catch(e){if(e.graphStatus===404){job.events.push({at:new Date().toISOString(),message:'Kein Belegordner für '+relative});}else throw e;}
    }
   }
   downloadTotal+=Math.max(0,plan.length-(downloadTotal-1));
   job.searchScope={lookbackMonths:3,foldersRead,plannedReceipts:plan.length};store.save(job);
   for(const item of plan)await copyReceipt(item.entry,item.relative,item.destination);
   if(c.cloud.collectionPath){cleanPath(c.cloud.collectionPath);try{const collected=await ms.driveList(owner,job.companyId,c.cloud.collectionPath);downloadTotal+=collected.filter(supported).length;for(const entry of collected.filter(supported))await copyReceipt(entry,c.cloud.collectionPath,local.collectionFolder);}catch(e){if(store.get(owner,id)?.cancelRequested)throw e;job.issues.push('OneDrive-Sammelordner: '+(e.status?e.message:'Quelle nicht vollständig lesbar.'));}}
   async function readImported(imported){
    try{const src=await inside(c.root,imported.path),bytes=await fs.readFile(src);if(hash(bytes)!==imported.hash)fail('Importdatei wurde verändert; erneuten Import prüfen.',409);return {src,bytes};}
    catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e;}
    // Older versions moved an attached import into a job but left its registry path unchanged.
    for(const previous of store.list(owner,job.companyId))for(const document of previous.documents||[]){
     if(document.hash!==imported.hash||!document.path)continue;
     let bytes;try{bytes=await fs.readFile(await inside(c.root,document.path));}catch{continue;}if(hash(bytes)!==imported.hash)continue;
     const importsFolder=path.join(ownerRoot,'imports');await fs.mkdir(importsFolder,{recursive:true,mode:0o700});const safeFolder=await inside(c.root,importsFolder,'directory');
     const src=await writeVerified(safeFolder,path.basename(imported.path||imported.originalName),bytes);store.putImport(owner,job.companyId,imported.hash,{...imported,path:src,recoveredAt:new Date().toISOString()});
     job.events.push({at:new Date().toISOString(),message:'Importbeleg aus vorhandener hashgeprüfter Kopie wiederhergestellt: '+imported.originalName});return {src,bytes};
    }
    fail('Importdatei fehlt und es ist keine hashgeprüfte Kopie verfügbar.',409);
   }
   for(const imported of store.imports(owner,job.companyId)){
    try{const {src,bytes}=await readImported(imported);await writeVerified(local.collectionFolder,path.basename(src),bytes);}
    catch(e){job.issues.push('Importbeleg '+(imported.originalName||imported.hash)+': '+(e.status?e.message:'Datei nicht lesbar. Die übrigen Belegquellen werden weiter geprüft.'));}
   }
   job.cloudSources=snapshots;job.execution='server';store.save(job);await worker.run(id,owner,local);
  }catch(e){job=store.get(owner,id);job.issues.push(e.status?e.message:'OneDrive-Verarbeitung fehlgeschlagen. Verbindung und Berechtigungen prüfen.');job.progress='Serverprüfung angehalten';store.save(job,job.cancelRequested?'cancelled':'waiting_for_user');}
  finally{running.delete(id);}
 }
 return {run};
}
module.exports={cloudWorker};

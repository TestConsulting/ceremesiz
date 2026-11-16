const fs=require('node:fs/promises'),path=require('node:path');
const {hash,inside,fail}=require('./core'),{advance}=require('./progress');
function bankSync(drive,canWrite){
 return {
  async source(job,relative,bytes,source,store){
   const currentHash=hash(bytes),parent=path.posix.dirname(relative)==='.'?'':path.posix.dirname(relative);
   const previous=store.list(job.owner,job.companyId).find(j=>j.id!==job.id&&j.cloudPublished?.path===relative&&j.cloudPublished.hash===currentHash);
   let original=bytes,backupPath=null;
   if(previous?.bankSource?.backupPath){
    backupPath=previous.bankSource.backupPath;
    if(path.posix.dirname(backupPath)!==(parent?parent+'/':'')+'_ASTRA_Originale')fail('Originalsicherung liegt außerhalb des Bankordners.');
    const saved=await drive.download(job.owner,job.companyId,backupPath);if(hash(saved.bytes)!==previous.bankSource.originalHash)fail('Originalsicherung wurde verändert.');original=saved.bytes;
   }
   job.bankSource={path:relative,eTag:source.eTag,currentHash,originalHash:hash(original),backupPath};return original;
  },
  async publish(job,c,store){
   if(!job.bankSource||!canWrite(job.owner,job.companyId)){job.issues.push('OneDrive-PDF noch nicht aktualisiert: Schreibzugriff freigeben und erneut prüfen.');return;}
   advance(job,store,'publish');
   const {path:relative}=job.bankSource,parent=path.posix.dirname(relative)==='.'?'':path.posix.dirname(relative);
   const backupFolder=await drive.ensureBackupFolder(job.owner,job.companyId,parent);
   const original=await fs.readFile(await inside(c.root,job.bankPdfPath));if(hash(original)!==job.bankSource.originalHash)fail('Originalbank stimmt nicht mit der Sicherung überein.');
   const backupPath=job.bankSource.backupPath||backupFolder+'/'+path.posix.parse(relative).name+'_'+hash(original)+'.pdf';
   try{await drive.download(job.owner,job.companyId,backupPath);}catch(e){if(e.graphStatus!==404)throw e;await drive.putPdf(job.owner,job.companyId,backupPath,original);}
   const backup=await drive.download(job.owner,job.companyId,backupPath);if(hash(backup.bytes)!==hash(original))fail('OneDrive-Originalsicherung ist nicht verifiziert.');
   job.bankSource.backupPath=backupPath;store.save(job,'running');
   const current=await drive.download(job.owner,job.companyId,relative);
   const expected=job.cloudPublished?.eTag||job.bankSource.eTag;
   if(current.source.eTag!==expected||hash(current.bytes)!==(job.cloudPublished?.hash||job.bankSource.currentHash))fail('OneDrive-Bankdatei wurde inzwischen geändert; kein Überschreiben.',409);
   const marked=await fs.readFile(await inside(c.root,job.markedPdfPath));
   const uploaded=await drive.putPdf(job.owner,job.companyId,relative,marked,expected);
   // Record the successful write before the verification read so a network interruption is recoverable.
   job.cloudPublished={path:relative,hash:hash(marked),eTag:uploaded.eTag,webUrl:uploaded.webUrl,at:new Date().toISOString(),verified:false};store.save(job,'running');
   const checked=await drive.download(job.owner,job.companyId,relative);if(hash(checked.bytes)!==hash(marked))fail('Geschriebene OneDrive-PDF nicht verifiziert.');
   job.cloudPublished.verified=true;job.cloudPublished.eTag=checked.source.eTag;
   job.events.push({at:new Date().toISOString(),message:'Ausgewählte OneDrive-Bank-PDF mit Farben aktualisiert; Original gesichert.'});
  }
 };
}
module.exports={bankSync};

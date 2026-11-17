const fs=require('node:fs/promises'),path=require('node:path');
const {inside,hash,writeVerified}=require('./core');
const folderName='Nicht zugewiesene Belege';
function candidates(job){
 const assigned=new Set((job.transactions||[]).filter(t=>t.status==='matched').flatMap(t=>(t.receipts||[]).map(r=>r.hash))),seen=new Set();
 return (job.documents||[]).filter(d=>['month','import'].includes(d.source)&&!assigned.has(d.hash)&&!seen.has(d.hash)&&seen.add(d.hash)).map(d=>({document:d,reason:d.duplicateOf?'Doppelte Fassung eines anderen Belegs':d.requiresReview||!d.verified?'Firmenzuordnung oder OCR prüfen':'Keine sichere Bankzuordnung'}));
}
async function createReview(job,c){
 const month=await inside(c.root,job.monthFolderPath,'directory'),base=path.join(month,folderName);await fs.mkdir(base,{recursive:true});const safeBase=await inside(month,base,'directory'),at=new Date().toISOString(),stamp=at.replace(/[-:.]/g,''),snapshotName=stamp+'_'+job.id.slice(0,8),destination=path.join(safeBase,snapshotName);await fs.mkdir(destination);const safeDestination=await inside(safeBase,destination,'directory'),files=[],rows=[],errors=[];
 for(const {document:d,reason} of candidates(job)){
  const originalName=d.originalName||d.name;
  try{const bytes=await fs.readFile(await inside(c.root,d.path));if(hash(bytes)!==d.hash)throw Error('Prüfsumme stimmt nicht.');const parsed=path.parse(path.basename(originalName)),safeName=parsed.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,140)+'_'+d.hash.slice(0,12)+parsed.ext.toLowerCase();const saved=await writeVerified(safeDestination,safeName,bytes);files.push({path:saved,name:path.basename(saved),hash:d.hash});rows.push({name:originalName,copy:path.basename(saved),reason});}
  catch{rows.push({name:originalName,copy:null,reason:'Kopie nicht verfügbar; Originalbestand prüfen'});errors.push(originalName);}
 }
 const text=['ASTRA FIBU – Nicht zugewiesene Belege','Stand: '+at,'Prüflauf: '+job.id,'Ergebnis des Prüflaufs vom: '+(job.created||'unbekannt'),'Letzte Dokumentprüfung: '+(job.lastSuccessfulCheck||'noch nicht gesetzt'),'Prüfmonat: '+job.month,'','Kopien der nicht zugeordneten PDF-/Bildbelege aus diesem Monatsordner sowie nachträglich zu diesem Lauf importierter Belege. Andere Monatsordner und allgemeine E-Post-Anhänge sind nicht enthalten.','Originaldateien bleiben unverändert. Vor einem Löschen Inhalt, Zeitraum und Zuordnung prüfen. Ältere Unterordner enthalten frühere Stände.','','Anzahl: '+rows.length,'',...rows.flatMap(r=>[r.name,'  Status: '+r.reason,'  Kopie: '+(r.copy||'nicht erstellt'),''])].join('\n');
 const manifest=await writeVerified(safeDestination,'Uebersicht.txt',Buffer.from(text,'utf8'));files.push({path:manifest,name:path.basename(manifest),hash:hash(Buffer.from(text,'utf8'))});
 job.unassignedReview={createdAt:at,folderName,snapshotName,path:safeDestination,count:rows.length,copied:rows.filter(r=>r.copy).length,rows,files,errors,published:false};return job.unassignedReview;
}
async function publishReview(job,c,drive,canWrite){
 if(!canWrite(job.owner,job.companyId))throw Error('OneDrive-Schreibzugriff fehlt.');const r=job.unassignedReview,parent=job.sourceMonthPath;await drive.ensureFolder(job.owner,job.companyId,parent,folderName);const relative=(parent?parent+'/':'')+folderName;await drive.ensureFolder(job.owner,job.companyId,relative,r.snapshotName);const snapshot=relative+'/'+r.snapshotName;
 for(const file of r.files){const bytes=await fs.readFile(await inside(c.root,file.path));if(hash(bytes)!==file.hash)throw Error('Ausgabekopie wurde verändert.');await drive.putReviewFile(job.owner,job.companyId,snapshot+'/'+file.name,bytes);const checked=await drive.download(job.owner,job.companyId,snapshot+'/'+file.name);if(hash(checked.bytes)!==file.hash)throw Error('OneDrive-Ausgabekopie nicht verifiziert.');}
 r.published=true;r.drivePath=snapshot;r.webUrl=(await drive.folder(job.owner,job.companyId,snapshot)).webUrl;return r;
}
module.exports={folderName,candidates,createReview,publishReview};

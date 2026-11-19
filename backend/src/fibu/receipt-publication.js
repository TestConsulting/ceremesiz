const fs=require('node:fs/promises'),path=require('node:path');
const {inside,hash}=require('./core'),{cleanPath}=require('./onedrive');
async function publish(job,c,drive,canWrite){
 const parent=cleanPath(job.sourceMonthPath,{empty:true}),receipts=[...new Map((job.transactions||[]).filter(t=>t.status==='matched').flatMap(t=>t.receipts||[]).map(r=>[r.hash,r])).values()],report={target:parent,verified:false,files:[],errors:[],at:new Date().toISOString()};job.receiptPublication=report;
 if(!canWrite(job.owner,job.companyId)){report.errors=receipts.map(r=>({hash:r.hash,name:r.name,error:'OneDrive-Schreibzugriff fehlt.'}));return report;}
 const existingByHash=new Map();report.scanIssues=[];
 for(const entry of await drive.list(job.owner,job.companyId,parent)){if(!entry.file||! /\.(pdf|png|jpe?g)$/i.test(entry.name)||entry.name===path.posix.basename(job.sourceBankName||''))continue;const relative=(parent?parent+'/':'')+entry.name;try{const checked=await drive.download(job.owner,job.companyId,relative);existingByHash.set(hash(checked.bytes),{name:entry.name,path:relative});}catch(e){report.scanIssues.push(entry.name);}}
 for(const receipt of receipts){try{
  const bytes=await fs.readFile(await inside(c.root,receipt.path));if(hash(bytes)!==receipt.hash)throw Error('Belegdatei wurde seit der Zuordnung verändert.');const already=existingByHash.get(receipt.hash);if(already){report.files.push({hash:receipt.hash,name:already.name,path:already.path,reused:true,verified:true});for(const t of job.transactions||[])for(const r of t.receipts||[])if(r.hash===receipt.hash){r.oneDrivePath=already.path;r.oneDriveVerified=true;}continue;}let name=path.basename(receipt.name||receipt.path);if(/[\\/\x00-\x1f]/.test(name)||! /\.(pdf|png|jpe?g)$/i.test(name))throw Error('Ungültiger Belegname.');
  const parsed=path.posix.parse(name),bank=path.posix.basename(job.sourceBankName||'');if(name===bank)name=parsed.name+'_Beleg_'+receipt.hash.slice(0,12)+parsed.ext;
  let relative=(parent?parent+'/':'')+name,existing;
  try{existing=await drive.download(job.owner,job.companyId,relative);}catch(e){if(e.graphStatus!==404)throw e;}
  if(existing&&hash(existing.bytes)!==receipt.hash){name=parsed.name+'_'+receipt.hash.slice(0,12)+parsed.ext;relative=(parent?parent+'/':'')+name;try{existing=await drive.download(job.owner,job.companyId,relative);}catch(e){if(e.graphStatus!==404)throw e;existing=null;}if(existing&&hash(existing.bytes)!==receipt.hash)throw Error('Namenskonflikt; bestehende Datei bleibt erhalten.');}
  const reused=!!existing;if(!existing)await drive.putReceiptFile(job.owner,job.companyId,relative,bytes,parent);
  const checked=await drive.download(job.owner,job.companyId,relative);if(hash(checked.bytes)!==receipt.hash)throw Error('OneDrive-Belegkopie nicht verifiziert.');
  const source=job.cloudSources?.find(s=>s.hash===receipt.hash||s.localPath===receipt.originalPath||(s.name&&(job.documents||[]).find(d=>d.hash===receipt.hash)?.originalName===s.name));
  existingByHash.set(receipt.hash,{name,path:relative});report.files.push({hash:receipt.hash,name,path:relative,reused,verified:true,sourcePath:source?.path||null});for(const t of job.transactions||[])for(const r of t.receipts||[])if(r.hash===receipt.hash){r.oneDrivePath=relative;r.oneDriveVerified=true;}
 }catch(e){report.errors.push({hash:receipt.hash,name:receipt.name,error:e.status?e.message:e.message||'OneDrive-Ablage fehlgeschlagen.'});for(const t of job.transactions||[])for(const r of t.receipts||[])if(r.hash===receipt.hash)r.oneDriveVerified=false;}}
 report.verified=!report.errors.length;return report;
}
module.exports={publish};

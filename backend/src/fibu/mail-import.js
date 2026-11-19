const fs=require('node:fs/promises'),path=require('node:path');
const {inside,hash,writeVerified}=require('./core'),{advance}=require('./progress');
async function importMail({job,c,collection,ms,store,event,checkpoint}){
 job.mailDocumentPaths=[];job.mailSummary={messages:0,processed:0,stored:0,reused:0,marked:0,failed:0};
 if(!ms.connected(job.owner,job.companyId)){job.issues.push('E-Post nicht verbunden; keine E-Mail-Ablage.');return;}
 const mailbox=c.mailbox||'epost@testconsulting.de';job.searchScope={...job.searchScope,mailbox,mailFolder:'Posteingang',mailStatus:'reading',historicalReferences:[]};const messages=await ms.list(job.owner,job.companyId,mailbox);job.searchScope.mailStatus='searched';
 if(ms.search)for(const ref of require('./mail-references').mailReferences(job.transactions)){checkpoint(job);try{const found=await ms.search(job.owner,job.companyId,mailbox,ref);messages.push(...found);job.searchScope.historicalReferences.push({reference:ref,status:'searched',messages:found.length});}catch(e){job.searchScope.historicalReferences.push({reference:ref,status:'error'});job.issues.push('Historische Belegsuche: '+e.message);}}
 const unique=[...new Map(messages.map(m=>[m.id,m])).values()];job.mailSummary.messages=unique.length;
 for(const message of unique){
  checkpoint(job);advance(job,store,'mail',job.mailSummary.processed,unique.length);
  const previousFiles=store.mail(job.owner,job.companyId,message.id)?.files||[],files=[],issues=[];let attachments=[];
  try{attachments=await ms.attachments(job.owner,job.companyId,mailbox,message.id);}catch(e){issues.push('Anhänge konnten nicht geladen werden: '+e.message);}
  for(const a of attachments){checkpoint(job);try{
   if(a['@odata.type']!=='#microsoft.graph.fileAttachment'||typeof a.contentBytes!=='string')throw Error('Anhang nicht als Datei herunterladbar.');
   const encoded=a.contentBytes.replace(/\s/g,'');if(encoded.length>36*1024*1024||encoded.length%4!==0||/[^A-Za-z0-9+/=]/.test(encoded))throw Error('Anhang enthält ungültige oder zu große Download-Daten.');
   const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)throw Error('Anhang enthält ungültige Base64-Daten.');if(bytes.length>25*1024*1024)throw Error('Anhang über 25 MB; Ablage nicht erfolgt.');const digest=hash(bytes);
   const originalName=a.name||'Anhang',parsed=path.parse(path.basename(originalName.replace(/\\/g,'/'))),stem=parsed.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120)||'Anhang',extension=parsed.ext.replace(/[^.a-zA-Z0-9]/g,'').slice(0,20),name=stem+'_'+digest.slice(0,12)+extension;
   let saved;const previous=previousFiles.find(f=>f.hash===digest)||store.mailFile?.(job.owner,job.companyId,digest);if(previous)try{const p=await inside(c.root,previous.path);if(hash(await fs.readFile(p))===digest)saved=p;}catch{}
   if(saved)job.mailSummary.reused++;else{saved=await writeVerified(collection,name,bytes);job.mailSummary.stored++;}
   if(hash(await fs.readFile(await inside(c.root,saved)))!==digest)throw Error('Gespeicherter Anhang nicht verifiziert.');
   if(!job.mailDocumentPaths.includes(saved))job.mailDocumentPaths.push(saved);
   files.push({path:saved,hash:digest,originalName,messageId:message.id,attachmentId:a.id,at:new Date().toISOString()});
   store.putMail(job.owner,job.companyId,message.id,{completed:false,files,issues});event(job,'E-Post-Anhang verifiziert abgelegt: '+path.basename(saved));
  }catch(e){issues.push((a.name||a.id||'Anhang')+': '+e.message);}}
  if(!issues.length&&attachments.length>0&&files.length===attachments.length){
   // Storage verification is the only prerequisite. OCR and bank matching happen later.
   try{for(const file of files)if(hash(await fs.readFile(await inside(c.root,file.path)))!==file.hash)throw Error('Gespeicherter Anhang inzwischen verändert.');
    if(c.pilotMode===true){job.mailMarkingDeferred=true;store.putMail(job.owner,job.companyId,message.id,{completed:false,files,issues:[],markingDeferred:true});}
    else{await ms.complete(job.owner,job.companyId,mailbox,message.id);job.mailSummary.marked++;store.putMail(job.owner,job.companyId,message.id,{completed:true,files,issues:[]});event(job,'E-Post-Nachricht: alle Anhänge gespeichert/verifiziert; ASTRA und Erledigt gesetzt.');}
   }catch(e){issues.push('Ablage/Outlook-Markierung nicht vollständig: '+e.message);}
  }
  if(issues.length){job.mailSummary.failed++;job.issues.push(...issues);store.putMail(job.owner,job.companyId,message.id,{completed:false,files,issues});}
  job.mailSummary.processed++;advance(job,store,'mail',job.mailSummary.processed,unique.length);
 }
 event(job,'E-Post abgeschlossen: '+job.mailSummary.processed+' Nachrichten geprüft, '+job.mailSummary.marked+' markiert, '+job.mailSummary.failed+' mit Ablage-/Verbindungsfehlern.');
}
module.exports={importMail};

const crypto=require('node:crypto');
const {fail}=require('./core');
function cleanPath(value,{empty=false}={}){
 if(typeof value!=='string'||value.length>2000||/[\\:\x00-\x1f]/.test(value))fail('Ungültiger OneDrive-Pfad.',400);
 const parts=value.split('/');if(parts.some(p=>p==='.'||p==='..'||(!p&&value!=='')))fail('OneDrive-Pfad außerhalb des Firmenordners.',400);
 if(!value&&!empty)fail('OneDrive-Pfad fehlt.',400);return value;
}
function oneDrive({graph,config}){
 const route=(company,relative)=>{
  const root=cleanPath(config.companies[company]?.cloud?.rootPath),rel=cleanPath(relative,{empty:true});
  return 'me/drive/root:/'+(root+(rel?'/'+rel:'')).split('/').map(encodeURIComponent).join('/');
 };
 return {
  async ensureFolder(owner,company,parent,name){
   cleanPath(parent,{empty:true});cleanPath(name);if(name.includes('/'))fail('Ungültiger Ordnername.');const relative=(parent?parent+'/':'')+name;
   try{const item=await graph(owner,company,route(company,relative));if(!item.folder||item.remoteItem)fail('Ausgabeziel ist kein freigegebener Ordner.');return relative;}catch(e){if(e.graphStatus!==404)throw e;}
   const parentItem=await graph(owner,company,route(company,parent));if(!parentItem.folder||parentItem.remoteItem)fail('Zielordner nicht freigegeben.');await graph(owner,company,route(company,parent)+':/children',{method:'POST',body:JSON.stringify({name,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});return relative;
  },
  async putReviewFile(owner,company,relative,bytes){
   cleanPath(relative);if(!relative.split('/').includes('Nicht zugewiesene Belege')||bytes.length>25*1024*1024||! /\.(pdf|png|jpe?g|txt)$/i.test(relative))fail('Ungültige Belegprüf-Ausgabe.');
   const ext=relative.split('.').pop().toLowerCase();if(ext==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-'||ext==='png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||['jpg','jpeg'].includes(ext)&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))fail('Belegformat stimmt nicht.');
   return graph(owner,company,route(company,relative)+':/content?@microsoft.graph.conflictBehavior=fail',{method:'PUT',headers:{'Content-Type':ext==='txt'?'text/plain; charset=utf-8':ext==='pdf'?'application/pdf':ext==='png'?'image/png':'image/jpeg'},body:bytes});
  },
  async ensureBackupFolder(owner,company,parent){
   cleanPath(parent,{empty:true});const relative=(parent?parent+'/':'')+'_ASTRA_Originale';
   try{const item=await graph(owner,company,route(company,relative));if(!item.folder||item.remoteItem)fail('Originalsicherung ist kein Ordner.');return relative;}catch(e){if(e.graphStatus!==404)throw e;}
   const folder=await graph(owner,company,route(company,parent));if(!folder.folder||folder.remoteItem)fail('Zielordner nicht freigegeben.');
   await graph(owner,company,route(company,parent)+':/children',{method:'POST',body:JSON.stringify({name:'_ASTRA_Originale',folder:{},'@microsoft.graph.conflictBehavior':'fail'})});return relative;
  },
  async putPdf(owner,company,relative,bytes,expectedEtag){
   cleanPath(relative);if(!/\.pdf$/i.test(relative)||bytes.length>25*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')fail('Nur verifizierte PDF-Ausgaben bis 25 MB schreiben.');
   return graph(owner,company,route(company,relative)+':/content'+(expectedEtag?'':'?@microsoft.graph.conflictBehavior=fail'),{method:'PUT',headers:{'Content-Type':'application/pdf',...(expectedEtag?{'If-Match':expectedEtag}:{})},body:bytes});
  },
  async folder(owner,company,relative=''){
   const item=await graph(owner,company,route(company,relative));
   if(!item.folder||item.remoteItem)fail('OneDrive-Ordner nicht verfügbar.',400);
   let webUrl;try{const u=new URL(item.webUrl);if(u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.endsWith('.sharepoint.com'))webUrl=u.href;}catch{}
   return {webUrl:webUrl||null};
  },
  async list(owner,company,relative=''){
   let next=route(company,relative)+':/children?$top=200',files=[];
   for(let n=0;next&&n<5;n++){const page=await graph(owner,company,next);files.push(...page.value);next=page['@odata.nextLink'];}
   if(next)fail('OneDrive-Ordner enthält mehr als 1000 Einträge. Ordner eingrenzen.');
   return files.filter(f=>!f.remoteItem).map(f=>({id:f.id,name:f.name,size:f.size,eTag:f.eTag,folder:!!f.folder,file:!!f.file}));
  },
  async download(owner,company,relative){
   const item=await graph(owner,company,route(company,relative));
   if(!item.file||item.remoteItem||item.size>25*1024*1024)fail('OneDrive-Datei ist kein unterstützter Beleg oder über 25 MB.');
   let url;try{url=new URL(item['@microsoft.graph.downloadUrl']);}catch{fail('OneDrive-Download nicht verfügbar.');}
   const host=url.hostname;
   if(url.protocol!=='https:'||url.username||url.password||url.port||!['sharepoint.com','sharepoint-df.com','1drv.com','onedrive.com'].some(d=>host.endsWith('.'+d)))fail('Unerwartetes OneDrive-Downloadziel.');
   // Pre-authenticated content URL: never forward the Graph bearer token.
   let response;
   for(let attempt=0;attempt<3;attempt++){
    response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
    if(response.ok)break;
    if(![429,500,502,503,504].includes(response.status)||attempt===2)fail('OneDrive-Download fehlgeschlagen (HTTP '+response.status+'). Datei manuell prüfen.');
    const retry=Number(response.headers.get('retry-after'))||2**(attempt+1);await response.body?.cancel();await new Promise(r=>setTimeout(r,Math.min(30,Math.max(1,retry))*1000));
   }
   const parts=[];let length=0;
   for await(const chunk of response.body){length+=chunk.length;if(length>25*1024*1024){await response.body.cancel().catch(()=>{});fail('OneDrive-Datei über 25 MB.');}parts.push(Buffer.from(chunk));}
   const bytes=Buffer.concat(parts),after=await graph(owner,company,route(company,relative));
   if(item.eTag!==after.eTag||bytes.length!==item.size)fail('OneDrive-Datei wurde während des Downloads verändert. Neuer Lauf erforderlich.',409);
   if(item.file.hashes?.sha1Hash&&crypto.createHash('sha1').update(bytes).digest('hex').toLowerCase()!==item.file.hashes.sha1Hash.toLowerCase())fail('OneDrive-Prüfsumme stimmt nicht.');
   return {bytes,source:{id:item.id,eTag:item.eTag,name:item.name,size:item.size}};
  }
 };
}
module.exports={oneDrive,cleanPath};

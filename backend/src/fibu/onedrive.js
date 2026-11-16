const crypto=require('node:crypto');
const {fail}=require('./core');
function cleanPath(value,{empty=false}={}){
 if(typeof value!=='string'||value.length>2000||/[\\\x00-\x1f]/.test(value))fail('Ungültiger OneDrive-Pfad.',400);
 const parts=value.split('/');if(parts.some(p=>p==='.'||p==='..'||(!p&&value!=='')))fail('OneDrive-Pfad außerhalb des Firmenordners.',400);
 if(!value&&!empty)fail('OneDrive-Pfad fehlt.',400);return value;
}
function oneDrive({graph,config}){
 const route=(company,relative)=>{
  const root=cleanPath(config.companies[company]?.cloud?.rootPath),rel=cleanPath(relative,{empty:true});
  return 'me/drive/root:/'+(root+(rel?'/'+rel:'')).split('/').map(encodeURIComponent).join('/');
 };
 return {
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
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
   if(!response.ok)fail('OneDrive-Download fehlgeschlagen. Erneut prüfen.');
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

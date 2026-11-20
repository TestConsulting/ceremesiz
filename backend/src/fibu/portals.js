const fs=require('node:fs/promises'),path=require('node:path'),{fork}=require('node:child_process');
const {fail,hash,inside,writeVerified,classify,match,norm}=require('./core');
const {catalog,validateAccount,publicAccount}=require('./portal-catalog');
function portals({db,store,vault=require('./portal-vault').portalVault(db),execute}){
 const definitions=require('./portal-definitions').definitions(db);
 const active=new Map(),key=(c,p)=>c+':'+p;
 // A browser process does not survive a server restart. Never report an old task as running.
 for(const row of db.prepare('SELECT company,provider,payload FROM fibu_portal_status').all()){const s=JSON.parse(row.payload);if(['running','downloading','interaction_required'].includes(s.state))vault.setStatus(row.company,row.provider,{...s,state:'interrupted',message:'Server neu gestartet. Abruf erneut starten.',updatedAt:new Date().toISOString()});}
 const status=(company,provider,state,message,extra={})=>{const value={state,message,updatedAt:new Date().toISOString(),...extra};vault.setStatus(company,provider,value);return value;};
 function list(company){const entries=[...definitions.all(company)];return {vaultReady:vault.ready,accounts:entries.filter(([,d])=>!d.removedAt).map(([p,d])=>publicAccount(p,vault.ready?vault.get(company,p):null,vault.status(company,p),d)),removed:entries.filter(([,d])=>d.removedAt).map(([id,d])=>({id,name:d.name,version:d.version}))};}
 function save(company,provider,body,actor){
  if(active.has(key(company,provider)))fail('Portalabruf läuft. Zugang danach ändern.',409);
  return db.transaction(()=>{let definition=definitions.get(company,provider);const old=vault.get(company,provider),value=validateAccount(provider,body,old,definition);value.updatedBy=actor;
   if(body.keywords!==undefined){const words=require('./portal-definitions').keywords(body.keywords);definition=definitions.put(company,provider,{...definition,keywords:words},body.definitionVersion);}
   const version=vault.put(company,provider,value,body.version);status(company,provider,value.enabled?'ready':'disabled',value.enabled?'Zugang gespeichert · Abruf testen':'Portal deaktiviert');return publicAccount(provider,{...value,version},vault.status(company,provider),definition);
  })();
 }

 function childExecution(input,callbacks){return new Promise((resolve,reject)=>{
  const child=fork(path.join(__dirname,'portal-child.js'),[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,execArgv:['--max-old-space-size=512']}),task=active.get(key(input.company,input.provider));let done=false;
  const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);child.kill();err?reject(err):resolve(value);};
  const timer=setTimeout(()=>finish(Object.assign(Error('timeout'),{code:'timeout'})),180000);
  task.sendCode=code=>child.send({type:'code',code});task.cancel=()=>finish(Object.assign(Error('cancelled'),{code:'cancelled'}));
  child.on('message',m=>{if(m.type==='status')callbacks.status(m.state,m.message);if(m.type==='result')finish(null,{session:m.session,files:m.files.map(f=>({name:f.name,bytes:Buffer.from(f.data,'base64')}))});if(m.type==='error')finish(Object.assign(Error('portal_failed'),{code:m.code}));});child.once('error',()=>finish(Error('browser_unavailable')));child.once('exit',()=>finish(Error('browser_closed')));child.send({type:'start',input});
 });}
 async function run(company,provider,month,c,owner,{job=null}={}){
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))fail('Prüfmonat angeben.',400);
  const definition=definitions.get(company,provider),account=vault.get(company,provider);if(!account?.enabled)fail('Aktiven Portalzugang hinterlegen.',409);
  const k=key(company,provider);if(active.has(k))fail('Dieses Portal wird für diese Firma bereits geprüft.',409);
  if(active.size>=2)fail('Zwei Portalabrufe laufen bereits. Kurz warten.',409);
  const task={id:require('node:crypto').randomUUID()};active.set(k,task);status(company,provider,'running','Server meldet sich beim Lieferanten an.',{taskId:task.id,month});
  const version=account.version;
  try{
   const result=await (execute||childExecution)({company,provider,definition,account,month},{status:(state,message)=>status(company,provider,state,message,{taskId:task.id,month,waitingCode:state==='interaction_required'})});
   const saved=[];for(const f of result.files){const d=require('./sources').validateImport({source:provider,name:f.name,data:f.bytes.toString('base64')},[...definitions.all(company).keys()]);
    const folder=c.portalImportFolder||path.join(c.root,String(owner),'imports');await fs.mkdir(folder,{recursive:true,mode:0o700});await inside(c.root,folder,'directory');
    const file=await writeVerified(folder,'Portal_'+provider+'_'+d.hash.slice(0,12)+'.pdf',d.bytes),record={hash:d.hash,path:file,source:provider,originalName:d.name,importedAt:new Date().toISOString(),importedBy:owner,portalMonth:month};store.putImport(owner,company,d.hash,record);saved.push(record);
    if(job)await writeVerified(c.collectionFolder,path.basename(file),d.bytes);
   }
   vault.put(company,provider,{...account,session:result.session||null,lastCheckedAt:new Date().toISOString()},version);
   return status(company,provider,saved.length?'downloaded':'no_documents',saved.length?saved.length+' Rechnung(en) verifiziert heruntergeladen.':'Keine Rechnung für '+month+' gefunden. Rechnungsseite und Auswahlpfade prüfen.',{taskId:task.id,month,count:saved.length,files:saved.map(d=>({name:d.originalName,hash:d.hash}))});
  }catch(e){return status(company,provider,e.code==='interaction_required'?'interaction_required':e.code==='cancelled'?'cancelled':'failed',e.code==='interaction_required'?'Anmeldung oder zusätzliche Bestätigung beim Lieferanten erforderlich.':e.code==='timeout'?'Zeitlimit erreicht. Erneut versuchen oder Zugang prüfen.':e.code==='cancelled'?'Abruf abgebrochen.':'Abruf fehlgeschlagen. Zugang, Rechnungsseite und Browserinstallation prüfen.',{taskId:task.id,month});}
  finally{active.delete(k);}
 }
 function start(company,provider,month,c,owner){if(active.size>=2)fail('Zwei Portalabrufe laufen bereits. Kurz warten.',409);if(active.has(key(company,provider)))fail('Portalabruf läuft bereits.',409);const promise=run(company,provider,month,c,owner);promise.catch(()=>{});return promise;}
 function code(company,provider,taskId,value){const task=active.get(key(company,provider)),s=vault.status(company,provider);if(!task||task.id!==taskId||s?.state!=='interaction_required'||!task.sendCode)fail('Keine offene Code-Anfrage. Abruf erneut starten.',409);if(typeof value!=='string'||! /^[a-zA-Z0-9 -]{4,16}$/.test(value))fail('Gültigen Bestätigungscode eingeben.',400);status(company,provider,'running','Bestätigung wird geprüft.',{taskId,month:s.month});task.sendCode(value);}
 async function forJob(job,c,owner,checkpoint){job.portalChecks||=[];for(const provider of vault.ids(job.companyId)){
   const definition=definitions.all(job.companyId).get(provider);if(!definition||definition.removedAt)continue;const a=vault.get(job.companyId,provider);if(!a?.enabled||!a.automatic)continue;
   const markers=definition.keywords.map(norm),needed=job.transactions.some(t=>!classify(t,c).skipReceipt&&classify(t,c).color!=='purple'&&match(t,job.documents||[]).length===0&&markers.some(marker=>norm((t.counterparty||'')+' '+t.description).includes(marker)));
   if(!needed)continue;await checkpoint();
   let check;try{check=await run(job.companyId,provider,job.month,c,owner,{job});}catch{check={state:'failed',message:'Portal konnte nicht geprüft werden. Zugang und laufende Abrufe prüfen.',updatedAt:new Date().toISOString()};}
   job.portalChecks=job.portalChecks.filter(p=>p.provider!==provider);job.portalChecks.push({provider,name:definition.name,...check});store.save(job);await checkpoint();
  }}
 function remove(company,provider,version,actor){if(active.has(key(company,provider)))fail('Laufenden Portalabruf zuerst abbrechen.',409);const old=definitions.get(company,provider);return db.transaction(()=>{definitions.put(company,provider,{...old,removedAt:new Date().toISOString(),removedBy:actor},version);const account=vault.ready?vault.get(company,provider):null;if(account)vault.put(company,provider,{...account,enabled:false,automatic:false,session:null},account.version);status(company,provider,'removed','Portal entfernt · keine weiteren Abrufe');return {removed:true};})();}
 function restore(company,provider,version){const old=definitions.get(company,provider,{removed:true});if(!old.removedAt)fail('Portal ist nicht entfernt.',409);if(list(company).accounts.length>=50)fail('Maximal 50 Portale je Firma.',400);definitions.put(company,provider,{...old,removedAt:null},version);status(company,provider,'disabled','Wiederhergestellt · Zugang bei Bedarf aktivieren');return {restored:true};}
 return {list,save,run,start,code,forJob,remove,restore,add:(company,body,actor)=>definitions.add(company,body,actor),status:(company,provider)=>vault.status(company,provider),cancel(company,provider){active.get(key(company,provider))?.cancel?.();},active};
}
module.exports={portals};

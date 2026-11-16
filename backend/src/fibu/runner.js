// Opt-in Windows execution service. Polls only explicit portal jobs; never schedules a scan.
require('dotenv').config({path:require('node:path').join(__dirname,'../../.env'),quiet:true});
const fs=require('node:fs/promises');
const path=require('node:path');
const Database=require('better-sqlite3');
const {loadConfig}=require('./config');
const {createStore}=require('./store');
const {engine}=require('./engine');
const {hash,inside,fail,classify,writeVerified}=require('./core');
async function main() {
  const portal=new URL(process.env.FIBU_PORTAL_URL||'http://127.0.0.1:4000');
  if(portal.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(portal.hostname))fail('Portal muss HTTPS verwenden.');
  if(portal.pathname!=='/'||portal.search||portal.hash||portal.username||portal.password)fail('Nur Portal-Ursprung ohne Pfad/Anmeldedaten konfigurieren.');
  const secret=process.env.FIBU_RUNNER_SECRET;if(!secret||! /^[A-Za-z0-9_-]{43,128}$/.test(secret))fail('Eigenen Kopplungsschlüssel mit mindestens 256 Bit konfigurieren.');
  const config=loadConfig(),company=process.env.FIBU_RUNNER_COMPANY||'tc',c=config.companies[company];
  if(config.mode!=='local'||!c?.enabled)fail('Lokale Firmenwurzel für den Windows-Dienst fehlt.');
  const dbPath=process.env.FIBU_RUNNER_DB||path.join(__dirname,'../../data/fibu-runner.db');await fs.mkdir(path.dirname(dbPath),{recursive:true});
  const db=new Database(dbPath),store=createStore(db);db.pragma('journal_mode=WAL');
  let stopping=false;process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
  let leaseId=null;
  const post=async(route,body={})=>{
    const r=await fetch(new URL('/api/fibu-runner/'+route,portal),{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({...body,leaseId}),signal:AbortSignal.timeout(120000),redirect:'error'});
    const data=await r.json();if(!r.ok)fail(data.error||'Portal nicht erreichbar.');return data;
  };
  async function execute(incoming) {
    leaseId=incoming.leaseId;
    if(incoming.companyId!==company)fail('Fremder Mandant im Auftrag.');
    store.adopt(incoming);let heartbeat;
    try {
      const connected=(await post(incoming.id+'/microsoft/connected')).connected;
      const ms={connected:()=>connected,list:async()=>(await post(incoming.id+'/microsoft/list')).value,
        search:async(o,c,m,reference)=>(await post(incoming.id+'/microsoft/search',{reference})).value,
        attachments:async(o,c,m,id)=>(await post(incoming.id+'/microsoft/attachments',{id})).value,
        complete:async(o,c,m,id)=>post(incoming.id+'/microsoft/complete',{id})};
      const worker=engine({store,config,ms});
      if(!incoming.pendingReview){
        const imports=(await post(incoming.id+'/imports')).imports;
        const collection=await inside(c.root,c.collectionFolder,'directory');
        for(const d of imports){
          const received=(await post(incoming.id+'/imports',{digest:d.hash})).import,bytes=Buffer.from(received.data,'base64');
          if(bytes.length>25*1024*1024||hash(bytes)!==d.hash)fail('Portalimport unvollständig.');
          const saved=await writeVerified(collection,'Portal_'+d.source+'_'+d.hash.slice(0,12)+path.extname(d.originalName),bytes);
          store.putImport(incoming.owner,company,d.hash,{...d,path:saved});
        }
      }
      const checked=await worker.validate(c,incoming);
      if(incoming.bankHash&&incoming.bankHash!==checked.bankHash)fail('Originalbank gegenüber früherer Prüfung verändert.');
      const job={...incoming,bankHash:checked.bankHash};store.adopt(job);
      heartbeat=setInterval(()=>post(incoming.id+'/heartbeat').then(status=>{
        if(status.cancelRequested||status.state!=='running'){const j=store.get(job.owner,job.id);j.cancelRequested=true;store.save(j);}
      }).catch(()=>{}),2000);
      if(job.pendingReview) {
        if(job.pendingReview.type==='document'){
          const d=job.documents.find(d=>d.id===job.pendingReview.documentId);if(!d)fail('Dokument fehlt.');
          await worker.verifyDocument(job,d,job.pendingReview.details,c);await worker.exportResult(job,c);job.pendingReview=null;store.save(job);
        }else{
        const review=job.pendingReview,t=job.transactions.find(t=>t.id===review.transactionId);
        if(!t)fail('Buchung der manuellen Prüfung fehlt.');
        if(review.documentId===null){Object.assign(t,classify(t,c));t.receipts=[];t.status=t.color==='purple'?'not_required':'missing';t.manualDecision='unmatched';}
        else {const d=job.documents.find(d=>d.id===review.documentId);if(!d?.verified||d.requiresReview)fail('Belegfirma/OCR nicht bestätigt.');await worker.assign(job,t,d,c);t.manualDecision='matched';}
        job.events.push({at:new Date().toISOString(),message:'Manuelle Zuordnung: '+review.reason,transactionId:t.id});
        await worker.exportResult(job,c);job.state=job.issues.length?'partial':job.transactions.some(t=>['missing','manual'].includes(t.status))?'waiting_for_user':'completed';job.pendingReview=null;store.save(job);
        }
      } else await worker.run(job.id,job.owner,c);
    }catch(e){const j=store.get(incoming.owner,incoming.id);j.issues.push(e.status?e.message:'Windows-Verarbeitung fehlgeschlagen. Lokale Konfiguration prüfen.');j.progress='Prüfung angehalten';store.save(j,'failed');}
    finally{clearInterval(heartbeat);}
    const result=store.get(incoming.owner,incoming.id),files=[];
    const paths=[['original',result.bankHash&&result.bankPdfPath],['marked',result.markedPdfPath],['report',result.reportPath],...(result.documents||[]).map(d=>[d.id,d.path])];
    let total=0;
    for(const [kind,file] of paths)if(file){
      try{const safe=await inside(c.root,file),bytes=await fs.readFile(safe);total+=bytes.length;if(total>70*1024*1024)fail('Ergebnis über 70 MB; lokales Ergebnis prüfen und Belege in kleineren Gruppen übernehmen.');files.push({kind,name:path.basename(safe),hash:hash(bytes),data:bytes.toString('base64')});}
      catch(e){result.issues.push('Dateiübertragung: '+(e.status?e.message:'Datei nicht mehr verfügbar.'));result.state='partial';}
    }
    await post(incoming.id+'/result',{result,files});
    leaseId=null;
  }
  console.log('Astra Windows-Dienst bereit. Führt nur manuell beauftragte Portal-Jobs aus.');
  try {while(!stopping){try{await post('status');const {job}=await post('claim');if(job)await execute(job);}catch{console.error('Portalverbindung unterbrochen. Kopplung/Netzwerk prüfen; kein neuer Scan gestartet.');}if(!stopping)await new Promise(r=>setTimeout(r,2000));}}
  finally{db.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.status?e.message:'Windows-Dienst konnte nicht gestartet werden. Konfiguration prüfen.');process.exitCode=1;});
module.exports={main};

const express=require('express');
const crypto=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs/promises');
const {hash,fail,writeVerified}=require('./core');
const outputRoot=()=>path.join(path.dirname(process.env.DB_PATH||path.join(__dirname,'../../data/ceremesiz.db')),'fibu-remote');
function runnerApi({store,config,ms,db}) {
  const router=express.Router(),company=process.env.FIBU_RUNNER_COMPANY||'tc';
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    const secret=process.env.FIBU_RUNNER_SECRET,given=req.get('Authorization')||'';
    if(config.mode!=='remote'||!config.companies[company]?.enabled||!secret||! /^[A-Za-z0-9_-]{43,128}$/.test(secret)||!given.startsWith('Bearer ')||!crypto.timingSafeEqual(crypto.createHash('sha256').update(given.slice(7)).digest(),crypto.createHash('sha256').update(secret).digest()))return res.status(401).json({error:'Windows-Dienst nicht gekoppelt.'});
    next();
  });
  router.use(express.json({limit:'100mb'}));
  router.post('/status',(req,res)=>{const seen=new Date().toISOString();db.prepare('INSERT INTO fibu_runner_state VALUES(?,?) ON CONFLICT(company) DO UPDATE SET seen=excluded.seen').run(company,seen);res.json({ok:true,seen});});
  const assigned=req=>{const r=db.prepare('SELECT owner FROM fibu_jobs WHERE id=? AND company=?').get(req.params.id,company);if(!r)fail('Auftrag nicht gefunden.',404);const j=store.get(r.owner,req.params.id);if(!j.leaseId||j.leaseId!==req.body?.leaseId)fail('Auftragskopplung abgelaufen.',409);return j;};
  const claim=db.transaction(()=>{
    // Expired leases are held for review, never silently retried.
    const old=db.prepare("SELECT owner,id FROM fibu_jobs WHERE company=? AND state='running' AND updated < ?").all(company,new Date(Date.now()-10*60*1000).toISOString());
    for(const r of old){const j=store.get(r.owner,r.id);j.issues.push('Windows-Dienst länger als zehn Minuten nicht erreichbar. Bereits ausgeführte Ablagen prüfen.');store.save(j,'partial');}
    if(db.prepare("SELECT id FROM fibu_jobs WHERE company=? AND state='running'").get(company))return null;
    const r=db.prepare("SELECT owner,id FROM fibu_jobs WHERE company=? AND state='queued' ORDER BY created LIMIT 1").get(company);
    if(!r)return null;const job=store.get(r.owner,r.id);job.leaseId=crypto.randomUUID();return store.save(job,'running');
  });
  router.post('/claim',(req,res)=>res.json({job:claim()}));
  router.post('/:id/heartbeat',(req,res)=>{const j=assigned(req);if(j.state==='running'){store.save(j);db.prepare('INSERT INTO fibu_runner_state VALUES(?,?) ON CONFLICT(company) DO UPDATE SET seen=excluded.seen').run(company,new Date().toISOString());}res.json({cancelRequested:j.cancelRequested,state:j.state});});
  router.post('/:id/imports',async(req,res)=>{
    const j=assigned(req);if(j.state!=='running')fail('Auftrag ist nicht aktiv.',409);
    const imports=store.imports(j.owner,company);
    if(!req.body.digest)return res.json({imports:imports.map(({path,...d})=>d)});
    const d=imports.find(d=>d.hash===req.body.digest);if(!d)fail('Import fehlt.',404);
    const file=await require('./core').inside(outputRoot(),d.path),bytes=await fs.readFile(file);if(hash(bytes)!==d.hash)fail('Import wurde verändert.',409);
    res.json({import:{...d,path:undefined,data:bytes.toString('base64')}});
  });
  router.post('/:id/microsoft/:action',async(req,res)=>{
    const j=assigned(req),c=config.companies[company],mailbox=c.mailbox||'epost@testconsulting.de';
    if(j.state!=='running')fail('Auftrag ist nicht aktiv.',409);
    let result;
    switch(req.params.action){
      case 'connected':result={connected:ms.connected(j.owner,company)};break;
      case 'list':result={value:await ms.list(j.owner,company,mailbox)};break;
      case 'attachments':if(typeof req.body.id!=='string')fail('Nachrichten-ID fehlt.',400);result={value:await ms.attachments(j.owner,company,mailbox,req.body.id)};break;
      case 'search':result={value:await ms.search(j.owner,company,mailbox,req.body.reference)};break;
      case 'complete':if(c.pilotMode===true)fail('Outlook-Markierungen sind im Pilotmodus gesperrt.',403);if(typeof req.body.id!=='string')fail('Nachrichten-ID fehlt.',400);await ms.complete(j.owner,company,mailbox,req.body.id);result={ok:true};break;
      default:fail('Aktion unbekannt.',400);
    }
    res.json(result);
  });
  router.post('/:id/result',async(req,res)=>{
    const old=assigned(req),{result,files}=req.body;
    if(old.state!=='running')fail('Auftrag ist nicht aktiv.',409);
    if(!result||result.id!==old.id||result.owner!==old.owner||result.companyId!==old.companyId||result.month!==old.month||!['completed','partial','waiting_for_user','failed','cancelled'].includes(result.state)||!Array.isArray(files)||files.length>500)fail('Ergebnis ungültig.',400);
    const folder=path.join(outputRoot(),String(old.owner),old.id);await fs.mkdir(folder,{recursive:true,mode:0o700});
    const remoteFiles={};let total=0;
    for(const f of files) {
      if(!f||typeof f.data!=='string'||typeof f.kind!=='string'||! /^(original|marked|report|[a-f0-9]{64})$/.test(f.kind))fail('Übertragene Datei ungültig.',400);
      const bytes=Buffer.from(f.data,'base64');total+=bytes.length;
      if(bytes.length>25*1024*1024||total>70*1024*1024||hash(bytes)!==f.hash)fail('Übertragung unvollständig oder zu groß.',400);
      remoteFiles[f.kind]=await writeVerified(folder,path.basename(f.name),bytes);
    }
    const saved={...result,id:old.id,owner:old.owner,companyId:old.companyId,month:old.month,created:old.created,remoteFiles,cancelRequested:old.cancelRequested,pendingReview:null};
    store.save(saved);
    if(saved.lastSuccessfulCheck)store.putMonth(saved.owner,saved.companyId,saved.month,{jobId:saved.id,bankHash:saved.bankHash,lastSuccessfulCheck:saved.lastSuccessfulCheck,transactions:saved.transactions},false,saved.folderId);
    res.json({ok:true});
  });
  router.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.status||422).json({error:err.status?err.message:'Windows-Dienst-Anfrage fehlgeschlagen.'});});
  return router;
}
module.exports={runnerApi,outputRoot};

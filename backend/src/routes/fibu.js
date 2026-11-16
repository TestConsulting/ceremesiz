const express=require('express');
const path=require('node:path');
const fs=require('node:fs/promises');
const {requireAuthApi}=require('../middleware/auth');
const {requireCsrf,requireSameOriginJson}=require('../middleware/csrf');
const {loadConfig,companyFor,names}=require('../fibu/config');
const {createStore}=require('../fibu/store');
const {engine}=require('../fibu/engine');
const {microsoft}=require('../fibu/microsoft');
const {inside,monthFromFolder,hash,fail,classify,writeVerified}=require('../fibu/core');
module.exports=function fibuRoutes({db,allowedOrigins,config=loadConfig(),ms=microsoft(config)}) {
  const router=express.Router(),store=createStore(db),worker=engine({store,config,ms});
  store.recover();
  router.use(requireAuthApi,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const write=[requireSameOriginJson(allowedOrigins),requireCsrf];
  router.get('/sources/:companyId',(req,res)=>{const c=companyFor(config,req.user,req.params.companyId);res.json({sources:require('../fibu/sources').sources(c),imports:store.imports(req.user.id,req.params.companyId).map(({path,...d})=>d)});});
  router.post('/imports/:companyId',...write,express.json({limit:'36mb'}),async(req,res)=>{
    const c=companyFor(config,req.user,req.params.companyId),d=require('../fibu/sources').validateImport(req.body);
    const folder=config.mode==='local'?await inside(c.root,c.collectionFolder,'directory'):path.join(require('../fibu/runner-api').outputRoot(),'imports',String(req.user.id),req.params.companyId);
    if(config.mode==='remote')await fs.mkdir(folder,{recursive:true,mode:0o700});
    const saved=await writeVerified(folder,'Portal_'+d.source+'_'+d.hash.slice(0,12)+path.extname(d.name).toLowerCase(),d.bytes);
    const record={hash:d.hash,path:saved,source:d.source,originalName:d.name,importedAt:new Date().toISOString(),importedBy:req.user.id};
    store.putImport(req.user.id,req.params.companyId,d.hash,record);
    res.status(201).json({hash:d.hash,source:d.source,originalName:d.name,status:'imported_unverified'});
  });
  const jobFor=req=>{const j=store.get(req.user.id,req.params.id);if(!j)fail('Prüflauf nicht gefunden.',404);companyFor(config,req.user,j.companyId);return j;};
  router.get('/companies',(req,res)=>res.json({mode:config.mode,demo:config.demo===true,companies:Object.entries(names).map(([id,name])=>{
    let enabled=false,canConnect=false;try{companyFor(config,req.user,id);enabled=true;}catch{}
    try{companyFor(config,req.user,id,{allowDisabled:true});canConnect=true;}catch{}
    const seen=canConnect?db.prepare('SELECT seen FROM fibu_runner_state WHERE company=?').get(id)?.seen:null;
    return {id,name,enabled,canConnect,runnerOnline:!!seen&&Date.now()-Date.parse(seen)<30000,runnerLastSeen:seen||null,documentCompanyName:canConnect?config.companies?.[id]?.documentCompanyName:null,pilotMode:config.companies?.[id]?.pilotMode===true,microsoftConfigured:ms.configured,connected:canConnect&&ms.connected(req.user.id,id)};
  })}));
  router.get('/months',(req,res)=>{companyFor(config,req.user,req.query.companyId);res.json({months:store.folders(req.user.id,req.query.companyId)});});
  router.post('/months',...write,async(req,res)=>{
    const b=req.body,c=companyFor(config,req.user,b.companyId),month=monthFromFolder(b.monthFolderPath);
    if(b.monthFolderPath.length>2000||typeof b.bankPdfPath!=='string'||b.bankPdfPath.length>2000||b.monthFolderPath.split(/[\\/]/).includes('..')||b.bankPdfPath.split(/[\\/]/).includes('..'))fail('Ungültige Ordner-/Dateipfade.',400);
    if(store.isClosed(b.companyId,month))fail('Abgeschlossenen Monat zuerst wieder öffnen.',409);
    let folderUrl='';if(b.folderUrl){try{const u=new URL(b.folderUrl);if(u.protocol!=='https:'||u.username||u.password)throw Error();folderUrl=u.href;}catch{fail('Nur gültige HTTPS-Ordnerlinks erlauben.',400);}}
    if(config.mode==='local')await inside(c.root,b.monthFolderPath,'directory');
    const saved={companyId:b.companyId,month,monthFolderPath:b.monthFolderPath,bankPdfPath:b.bankPdfPath,folderUrl};
    store.putFolder(req.user.id,b.companyId,month,saved);res.json(saved);
  });
  router.get('/jobs',(req,res)=>{
    companyFor(config,req.user,req.query.companyId);
    res.json({jobs:store.list(req.user.id,req.query.companyId)});
  });
  router.post('/jobs',...write,async(req,res)=>{
    const b=req.body,c=companyFor(config,req.user,b.companyId),month=monthFromFolder(b.monthFolderPath);
    if(b.month&&b.month!==month)fail('Abweichender Monat.',400);
    if(config.mode==='remote') {
      if(typeof b.bankPdfPath!=='string'||b.bankPdfPath.length>2000||! /\.pdf$/i.test(b.bankPdfPath)||b.bankPdfPath.split(/[\\/]/).includes('..'))fail('Gültigen Bank-PDF-Pfad angeben.',400);
      const job=store.enqueue(req.user.id,{companyId:b.companyId,month,monthFolderPath:b.monthFolderPath,bankPdfPath:b.bankPdfPath,bankHash:null});
      return res.status(202).json(job);
    }
    const folder=await inside(c.root,b.monthFolderPath,'directory'),bank=await inside(folder,b.bankPdfPath);
    if(!/\.pdf$/i.test(bank)||/_Astra(?:_|\.)/i.test(bank))fail('Original-Bank-PDF auswählen.',400);
    const bytes=await fs.readFile(bank);if(bytes.subarray(0,5).toString()!=='%PDF-')fail('PDF ungültig.',400);
    const job=store.enqueue(req.user.id,{companyId:b.companyId,month,monthFolderPath:folder,bankPdfPath:bank,bankHash:hash(bytes)});
    res.status(202).json(job);
    setImmediate(()=>worker.run(job.id,req.user.id,c));
  });
  router.get('/jobs/:id',(req,res)=>res.json(jobFor(req)));
  router.post('/jobs/:id/documents/:documentId/verify',...write,async(req,res)=>{
    const job=jobFor(req),c=companyFor(config,req.user,job.companyId);
    if(store.hasActive(job.companyId,job.month)||worker.running.has(job.id)||store.isClosed(job.companyId,job.month))fail('Monat läuft oder ist abgeschlossen.',409);
    if(store.month(job.owner,job.companyId,job.month)?.jobId!==job.id)fail('Nur den neuesten Prüflauf bearbeiten.',409);
    const d=job.documents.find(d=>d.id===req.params.documentId);if(!d)fail('Dokument fehlt.',404);
    require('../fibu/review').validateReview(req.body,c);
    if(config.mode==='remote'){job.pendingReview={type:'document',documentId:d.id,details:req.body};return res.status(202).json(store.save(job,'queued'));}
    store.save(job,'running');worker.running.add(job.id);
    try{await worker.verifyDocument(job,d,req.body,c);await worker.exportResult(job,c);store.save(job);res.json(job);}
    catch(e){job.issues.push('Belegprüfung unterbrochen; gespeicherte Bestätigung und Ausgabe prüfen.');store.save(job,'partial');throw e;}
    finally{worker.running.delete(job.id);}
  });
  router.post('/jobs/:id/cancel',...write,(req,res)=>{
    const job=jobFor(req);if(['queued','running'].includes(job.state)){job.cancelRequested=true;store.save(job);}res.json(job);
  });
  router.post('/jobs/:id/assign',...write,async(req,res)=>{
    const job=jobFor(req),c=companyFor(config,req.user,job.companyId);
    if(['queued','running'].includes(job.state)||worker.running.has(job.id))fail('Prüflauf arbeitet noch.',409);
    if(store.isClosed(job.companyId,job.month))fail('Monat zuerst wieder öffnen.',409);
    if(store.month(job.owner,job.companyId,job.month)?.jobId!==job.id)fail('Nur den neuesten gespeicherten Prüflauf bearbeiten.',409);
    const t=job.transactions.find(t=>t.id===req.body.transactionId);if(!t)fail('Buchung fehlt.',404);
    if(typeof req.body.reason!=='string'||req.body.reason.trim().length<5)fail('Nachvollziehbaren Grund angeben.',400);
    if(config.mode==='remote') {
      if(req.body.documentId!==null&&!job.documents.some(d=>d.id===req.body.documentId&&d.verified&&!d.requiresReview))fail('Beleg nicht verifiziert.',400);
      job.pendingReview={transactionId:t.id,documentId:req.body.documentId,reason:req.body.reason.trim()};
      return res.status(202).json(store.save(job,'queued'));
    }
    // The same database lock covers reviews and jobs across users of the company.
    if(store.hasActive(job.companyId,job.month))fail('Für diese Firma und diesen Monat läuft bereits eine Prüfung.',409);
    store.save(job,'running');
    worker.running.add(job.id);
    try {
      if(req.body.documentId===null){Object.assign(t,classify(t,c));t.receipts=[];t.status=t.color==='purple'?'not_required':'missing';t.manualDecision='unmatched';}
      else {const d=job.documents.find(d=>d.id===req.body.documentId);if(!d?.verified||d.requiresReview)fail('Belegfirma/OCR nicht bestätigt. Dokument zuerst klären.');await worker.assign(job,t,d,c);t.manualDecision='matched';}
      job.events.push({at:new Date().toISOString(),message:'Manuelle Zuordnung: '+req.body.reason.trim(),transactionId:t.id});
      await worker.exportResult(job,c);job.state=job.issues.length?'partial':job.transactions.some(t=>['missing','manual'].includes(t.status))?'waiting_for_user':'completed';store.save(job);
      res.json(job);
    }catch(e){job.issues.push('Manuelle Änderung nur teilweise ausgeführt. Bereits verifizierte Ablagen prüfen.');job.progress='Manuelle Prüfung benötigt Klärung';store.save(job,'partial');throw e;}finally{worker.running.delete(job.id);}
  });
  router.post('/jobs/:id/month',...write,(req,res)=>{
    const job=jobFor(req),m=store.month(job.owner,job.companyId,job.month);
    if(req.body.action==='close'&&companyFor(config,req.user,job.companyId).pilotMode===true)fail('Eine Pilot-Arbeitskopie kann keinen produktiven Monatsabschluss erhalten.',409);
    if(!m)fail('Noch kein geprüfter Monat.',409);
    if(worker.running.has(job.id)||store.hasActive(job.companyId,job.month))fail('Prüfung läuft noch.',409);
    if(!['close','reopen'].includes(req.body.action))fail('Aktion ungültig.',400);
    if(store.isClosed(job.companyId,job.month)&&!m.closed)fail('Der Monat wurde von einem anderen Benutzer abgeschlossen. Dieser muss ihn ausdrücklich wieder öffnen.',409);
    if(req.body.action==='close'&&(m.jobId!==job.id||job.issues.length||!job.transactions.length||job.transactions.some(t=>['missing','manual'].includes(t.status))))fail('Offene Belege/Fehler verhindern den Monatsabschluss.',409);
    job.events.push({at:new Date().toISOString(),message:req.body.action==='close'?'Monat ausdrücklich abgeschlossen':'Monat ausdrücklich wieder geöffnet'});
    store.putMonth(job.owner,job.companyId,job.month,m,req.body.action==='close');store.save(job);res.json({closed:req.body.action==='close'});
  });
  router.get('/jobs/:id/files/:kind',async(req,res)=>{
    const job=jobFor(req),c=companyFor(config,req.user,job.companyId);
    let file=req.params.kind==='original'?job.bankPdfPath:req.params.kind==='marked'?job.markedPdfPath:req.params.kind==='report'?job.reportPath:job.documents.find(d=>d.id===req.params.kind)?.path;
    if(config.mode==='remote') {
      file=job.remoteFiles?.[req.params.kind];if(!file)fail('Datei noch nicht vom Windows-Dienst übertragen.',404);
      const safe=await inside(require('../fibu/runner-api').outputRoot(),file);
      res.set('Content-Disposition','inline; filename="'+encodeURIComponent(path.basename(safe))+'"');return res.sendFile(safe);
    }
    if(!file)fail('Datei nicht gefunden.',404);file=await inside(c.root,file);
    if(req.params.kind==='original'&&hash(await fs.readFile(file))!==job.bankHash)fail('Originalbank geändert. Neue Prüfung nötig.',409);
    res.set('Content-Disposition',`inline; filename="${encodeURIComponent(path.basename(file))}"`);
    res.sendFile(file);
  });
  router.post('/microsoft/:companyId/connect',...write,async(req,res)=>{companyFor(config,req.user,req.params.companyId,{allowDisabled:true});res.json(await ms.begin(req.user.id,req.params.companyId));});
  router.post('/microsoft/:companyId/poll',...write,async(req,res)=>{companyFor(config,req.user,req.params.companyId,{allowDisabled:true});res.json(await ms.poll(req.user.id,req.params.companyId));});
  router.post('/microsoft/:companyId/probe',...write,async(req,res)=>{const c=companyFor(config,req.user,req.params.companyId,{allowDisabled:true});res.json(await ms.probe(req.user.id,req.params.companyId,c.mailbox||'epost@testconsulting.de'));});
  router.post('/microsoft/:companyId/disconnect',...write,(req,res)=>{companyFor(config,req.user,req.params.companyId,{allowDisabled:true});ms.disconnect(req.user.id,req.params.companyId);res.json({connected:false});});
  router.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.status||422).json({error:err.status?err.message:'Dateizugriff oder Verarbeitung fehlgeschlagen. Konfiguration und Dateiberechtigungen prüfen.'});});
  router.runnerRouter=require('../fibu/runner-api').runnerApi({store,config,ms,db});
  return router;
};

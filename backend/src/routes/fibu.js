const express=require('express');
const path=require('node:path');
const fs=require('node:fs/promises');
const {requireAuthApi}=require('../middleware/auth');
const {requireCsrf,requireSameOriginJson}=require('../middleware/csrf');
const {loadConfig,companyFor:baseCompanyFor,names}=require('../fibu/config');
const {createStore}=require('../fibu/store');
const {engine}=require('../fibu/engine');
const {microsoft}=require('../fibu/microsoft');
const {inside,monthFromFolder,hash,fail,classify,writeVerified}=require('../fibu/core');
module.exports=function fibuRoutes({db,allowedOrigins,config=loadConfig(),ms,portalExecute}) {
  const uiVersion=require('../fibu/ui-version')();
  const router=express.Router(),store=require('../fibu/shared-store').sharedStore(db,createStore(db));
  const setup=require('../fibu/company-setup').companySetup(db,config);setup.restore();
  const rules=require('../fibu/rules').ruleStore(db);
  const companyFor=(config,user,id,options)=>rules.effective(id,baseCompanyFor(config,user,id,options));
  ms=ms||microsoft(config,config.mode==='cloud'?{vault:require('../fibu/token-vault').tokenVault(db),resolveOwner:store.primaryOwner}:{});
  const directMs=ms;ms=new Proxy(directMs,{get(target,key){const value=target[key];if(typeof value!=='function')return value;return (...args)=>{if(typeof args[0]==='number'&&typeof args[1]==='string')args[0]=store.primaryOwner(args[0],args[1]);return value.apply(target,args);};}});
  const portals=require('../fibu/portals').portals({db,store,execute:portalExecute});
  const worker=engine({store,config,ms,portals}),cloud=require('../fibu/cloud').cloudWorker({store,worker,ms});
  store.recover();
  router.use(requireAuthApi,(req,res,next)=>{res.set({'Cache-Control':'no-store','X-FiBu-UI-Version':uiVersion});next();});
  const write=[requireSameOriginJson(allowedOrigins),requireCsrf];
  router.get('/portals/:companyId',(req,res)=>{companyFor(config,req.user,req.params.companyId);res.json(portals.list(req.params.companyId));});
  router.post('/portals/:companyId',...write,(req,res)=>{companyFor(config,req.user,req.params.companyId);res.status(201).json(portals.add(req.params.companyId,req.body,req.user.email));});
  router.post('/portals/:companyId/:provider/remove',...write,(req,res)=>{companyFor(config,req.user,req.params.companyId);if(req.body.confirmRemove!==true)fail('Entfernen bestätigen.',400);res.json(portals.remove(req.params.companyId,req.params.provider,req.body.version,req.user.email));});
  router.post('/portals/:companyId/:provider/restore',...write,(req,res)=>{companyFor(config,req.user,req.params.companyId);res.json(portals.restore(req.params.companyId,req.params.provider,req.body.version));});
  router.post('/portals/:companyId/:provider',...write,(req,res)=>{companyFor(config,req.user,req.params.companyId);res.json(portals.save(req.params.companyId,req.params.provider,req.body,req.user.email));});
  router.post('/portals/:companyId/:provider/run',...write,(req,res)=>{
    const c=companyFor(config,req.user,req.params.companyId),company=req.params.companyId,provider=req.params.provider;
    if(config.mode!=='cloud')fail('Portalabruf benötigt Serverbetrieb.',409);
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(req.body.month))fail('Prüfmonat angeben.',400);
    const a=portals.list(company).accounts.find(a=>a.id===provider);if(!a?.enabled)fail('Aktiven Portalzugang hinterlegen.',409);
    portals.start(company,provider,req.body.month,c,store.primaryOwner(req.user.id,company));res.status(202).json(portals.status(company,provider));
  });
  router.post('/portals/:companyId/:provider/code',...write,(req,res)=>{companyFor(config,req.user,req.params.companyId);portals.code(req.params.companyId,req.params.provider,req.body.taskId,req.body.code);res.json({accepted:true});});
  router.post('/portals/:companyId/:provider/cancel',...write,(req,res)=>{companyFor(config,req.user,req.params.companyId);portals.cancel(req.params.companyId,req.params.provider);res.json({accepted:true});});
  router.post('/setup/immo',...write,async(req,res)=>{if(req.body?.confirmCompanySetup!==true)fail('Freigabe der AC-Immo-Einrichtung erforderlich.',400);const value=setup.prepare(req.body);await fs.mkdir(value.root,{recursive:true,mode:0o700});res.status(201).json(setup.install(value,req.user.id));});
  router.get('/onedrive/:companyId',async(req,res)=>{const c=companyFor(config,req.user,req.params.companyId);if(config.mode!=='cloud')fail('Direkter OneDrive-Zugriff nicht aktiviert.',409);const relative=req.query.path??c.cloud.monthBasePath??'';require('../fibu/onedrive').cleanPath(relative,{empty:true});res.json({path:relative,entries:await ms.driveList(req.user.id,req.params.companyId,relative),...(ms.driveFolder?await ms.driveFolder(req.user.id,req.params.companyId,relative):{})});});
  router.get('/sources/:companyId',(req,res)=>{const c=companyFor(config,req.user,req.params.companyId);res.json({sources:portals.list(req.params.companyId).accounts.map(a=>({id:a.id,name:a.name,url:a.loginUrl,status:a.status.message,automatic:a.enabled&&a.automatic,mode:a.enabled?'server':'manual_download'})),imports:store.imports(req.user.id,req.params.companyId).map(({path,...d})=>d)});});
  router.post('/imports/:companyId',...write,express.json({limit:'36mb'}),async(req,res)=>{
    const c=companyFor(config,req.user,req.params.companyId),d=require('../fibu/sources').validateImport(req.body,portals.list(req.params.companyId).accounts.map(a=>a.id));
    let attachedJob=null,metadata=null,extracted=null;
    if(req.body.jobId){
      attachedJob=store.get(req.user.id,req.body.jobId);
      if(!attachedJob||attachedJob.companyId!==req.params.companyId)fail('Prüflauf nicht gefunden.',404);
      if(config.mode==='remote')fail('Direkter Import in einen Prüflauf benötigt Serverbetrieb oder lokalen Betrieb.',409);
      if(['queued','running'].includes(attachedJob.state)||!attachedJob.transactions?.length)fail('Beleg nur in einen beendeten Prüflauf übernehmen.',409);
      if(store.isClosed(attachedJob.companyId,attachedJob.month,attachedJob.folderId))fail('Monat ist abgeschlossen.',409);
      extracted=await require('../fibu/pdf').extractReceipt(d.bytes,/\.pdf$/i.test(d.name),{ocr:c.ocrEnabled===true});
      if(/Auszugszeitraum|Anfangssaldo|Endsaldo/i.test(extracted.text))fail('Kontoauszug ist kein Rechnungsbeleg.',400);
      metadata=require('../fibu/pdf').receiptMetadata(extracted,c);
    }
    let folder=config.mode==='local'?await inside(c.root,c.collectionFolder,'directory'):config.mode==='cloud'?path.join(c.root,String(req.user.id),'imports'):path.join(require('../fibu/runner-api').outputRoot(),'imports',String(req.user.id),req.params.companyId);
    if(config.mode!=='local')await fs.mkdir(folder,{recursive:true,mode:0o700});
    if(config.mode==='cloud')folder=await inside(c.root,folder,'directory');
    const saved=await writeVerified(folder,'Portal_'+d.source+'_'+d.hash.slice(0,12)+path.extname(d.name).toLowerCase(),d.bytes);
    const record={hash:d.hash,path:saved,source:d.source,originalName:d.name,importedAt:new Date().toISOString(),importedBy:req.user.id};
    store.putImport(req.user.id,req.params.companyId,d.hash,record);

    if(attachedJob){
      const document={id:d.hash,hash:d.hash,path:saved,name:d.name,...metadata,...(extracted.ocr?{ocr:extracted.ocr,requiresReview:true}:{}),source:'import',portalImport:record};
      if(!attachedJob.documents.some(x=>x.hash===d.hash))attachedJob.documents.push(require('../fibu/review').applyReview(document,store.documentReview(req.user.id,req.params.companyId,d.hash),c));
      attachedJob.events.push({at:new Date().toISOString(),message:'Lieferantenbeleg zum bestehenden Prüflauf importiert: '+d.name,documentHash:d.hash});store.save(attachedJob);
    }
    res.status(201).json({hash:d.hash,source:d.source,originalName:d.name,status:attachedJob?'attached_unassigned':'imported_unverified',...(attachedJob?{jobId:attachedJob.id,documentId:d.hash}:{})});
  });
  const jobFor=req=>{const j=store.get(req.user.id,req.params.id);if(!j)fail('Prüflauf nicht gefunden.',404);companyFor(config,req.user,j.companyId);return j;};
  router.get('/companies',(req,res)=>res.json({mode:config.mode,demo:config.demo===true,companies:Object.entries(names).map(([id,name])=>{
    let enabled=false,canConnect=false;try{companyFor(config,req.user,id);enabled=true;}catch{}
    try{companyFor(config,req.user,id,{allowDisabled:true});canConnect=true;}catch{}
    const seen=canConnect?db.prepare('SELECT seen FROM fibu_runner_state WHERE company=?').get(id)?.seen:null;
    return {id,name,enabled,canConnect,mailEnabled:config.companies?.[id]?.mailEnabled!==false,maxBankStatements:config.companies?.[id]?.bankAccounts?.length||1,cloudMonthBase:canConnect?config.companies?.[id]?.cloud?.monthBasePath:null,runnerOnline:!!seen&&Date.now()-Date.parse(seen)<30000,runnerLastSeen:seen||null,documentCompanyName:canConnect?config.companies?.[id]?.documentCompanyName:null,pilotMode:config.companies?.[id]?.pilotMode===true,microsoftConfigured:ms.configured,canWrite:canConnect&&!!ms.canWrite?.(req.user.id,id),connected:canConnect&&ms.connected(req.user.id,id)};
  })}));
  router.get('/months',(req,res)=>{companyFor(config,req.user,req.query.companyId);const all=store.folders(req.user.id,req.query.companyId,{includeHidden:true}).filter(m=>config.mode!=='cloud'||m.storageMode==='cloud');res.json({months:all.filter(m=>!m.removedAt),removed:all.filter(m=>m.removedAt).map(({id,name,label,month,removedAt})=>({id,name,label,month,removedAt}))});});
  router.get('/rules/:companyId',(req,res)=>{const c=baseCompanyFor(config,req.user,req.params.companyId);res.json(rules.get(req.params.companyId,c));});
  router.post('/rules/:companyId',...write,(req,res)=>{const c=baseCompanyFor(config,req.user,req.params.companyId);res.json(rules.save(req.params.companyId,c,req.body,req.user.email));});
  router.post('/months/:id/completion',...write,(req,res)=>{const company=req.body.companyId;companyFor(config,req.user,company);if(typeof req.body.complete!=='boolean')fail('Status vollständig angeben.',400);const entry=store.folders(req.user.id,company).find(m=>m.id===req.params.id);if(!entry)fail('FiBu-Eintrag nicht gefunden.',404);if(store.profileActive(req.user.id,company,entry.id))fail('Laufenden Prüflauf zuerst beenden.',409);store.putFolder(req.user.id,company,entry.id,{...entry,completed:req.body.complete,completedAt:new Date().toISOString(),completedBy:req.user.email});res.json({completed:req.body.complete});});
  router.get('/settings/:companyId',(req,res)=>{
    const c=companyFor(config,req.user,req.params.companyId);
    res.json({mailEnabled:c.mailEnabled!==false,mailbox:c.mailbox||'epost@testconsulting.de',mode:config.mode,pilotMode:c.pilotMode===true,ocrEnabled:c.ocrEnabled===true,greenCounterparties:(c.ignoreRules||[]).filter(r=>r.enabled&&r.color==='green').map(r=>r.label),payrollExceptions:c.payrollExceptions===true,mailStorage:config.mode==='cloud'?'privateServer':'configuredCollection',collectionSource:config.mode==='cloud'?(c.cloud.collectionPath?[c.cloud.rootPath,c.cloud.collectionPath].filter(Boolean).join('/'):null):c.collectionFolder});
  });
  router.post('/months/:id/remove',...write,(req,res)=>{
    const b=req.body;companyFor(config,req.user,b.companyId);
    const entry=store.folders(req.user.id,b.companyId).find(m=>m.id===req.params.id);if(!entry)fail('FiBu-Eintrag nicht gefunden.',404);
    if(store.profileActive(req.user.id,b.companyId,entry.id))fail('Laufenden Prüflauf zuerst beenden oder abbrechen.',409);
    store.putFolder(req.user.id,b.companyId,entry.id,{...entry,removedAt:new Date().toISOString()});res.json({removed:true});
  });
  router.post('/months/:id/restore',...write,(req,res)=>{
    const b=req.body;companyFor(config,req.user,b.companyId);
    const entry=store.folders(req.user.id,b.companyId,{includeHidden:true}).find(m=>m.id===req.params.id&&m.removedAt);if(!entry)fail('Entfernter Eintrag nicht gefunden.',404);
    store.putFolder(req.user.id,b.companyId,entry.id,{...entry,removedAt:null});res.json({restored:true});
  });
  router.post('/months',...write,async(req,res)=>{
    const b=req.body,c=companyFor(config,req.user,b.companyId),month=config.mode==='cloud'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(b.month)?b.month:monthFromFolder(b.monthFolderPath);
    if(b.monthFolderPath.length>2000||typeof b.bankPdfPath!=='string'||b.bankPdfPath.length>2000||b.monthFolderPath.split(/[\\/]/).includes('..')||b.bankPdfPath.split(/[\\/]/).includes('..'))fail('Ungültige Ordner-/Dateipfade.',400);
    const existing=b.id?store.folders(req.user.id,b.companyId).find(m=>m.id===b.id):null;
    if(b.id&&!existing)fail('FiBu-Eintrag nicht gefunden.',404);
    if(existing&&store.hasActive(b.companyId,month))fail('Während einer Prüfung die Pfade nicht ändern.',409);
    if(existing&&existing.month!==month)fail('Prüfmonat eines Eintrags nicht ändern.',400);
    const removedLegacy=store.folders(req.user.id,b.companyId,{includeHidden:true}).some(m=>m.id===month&&m.removedAt);
    const folderId=existing?.id||(b.create===true||removedLegacy?require('node:crypto').randomUUID():month);
    if(store.isClosed(b.companyId,month,folderId))fail('Abgeschlossenen Monat zuerst wieder öffnen.',409);
    if(b.name!==undefined&&(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>120))fail('Name mit 1 bis 120 Zeichen angeben.',400);
    if(b.label!==undefined&&(typeof b.label!=='string'||b.label.length>80))fail('Bezeichnung bis 80 Zeichen verwenden.',400);
    let folderUrl='';if(b.folderUrl){try{const u=new URL(b.folderUrl);if(u.protocol!=='https:'||u.username||u.password)throw Error();folderUrl=u.href;}catch{fail('Nur gültige HTTPS-Ordnerlinks erlauben.',400);}}
    if(config.mode==='local')await inside(c.root,b.monthFolderPath,'directory');
    if(config.mode==='cloud'){require('../fibu/onedrive').cleanPath(b.monthFolderPath,{empty:true});require('../fibu/onedrive').cleanPath(b.bankPdfPath);if(!/\.pdf$/i.test(b.bankPdfPath)||/_Astra(?:_|\.)/i.test(b.bankPdfPath))fail('Original-PDF aus OneDrive wählen.',400);}
    const bankPdfPaths=config.mode==='cloud'&&b.bankPdfPaths?require('../fibu/statements').paths(b.bankPdfPaths,b.bankPdfPath):undefined;if(bankPdfPaths&&(b.bankDrivePath!==true||bankPdfPaths[0]!==b.bankPdfPath||bankPdfPaths.length>(c.bankAccounts?.length||1)))fail('Auswahl stimmt nicht mit den Firmenkonten überein.',400);
    const saved={bankPdfPaths,id:folderId,name:b.name?.trim()||existing?.name||(existing?undefined:'FiBu '+month.slice(5)+'/'+month.slice(0,4)+(b.label?' · '+b.label.trim():'')),createdAt:existing?.createdAt||new Date().toISOString(),label:b.label?.trim()||existing?.label||'',companyId:b.companyId,month,monthFolderPath:b.monthFolderPath,bankPdfPath:b.bankPdfPath,bankDrivePath:config.mode==='cloud'&&b.bankDrivePath===true,folderUrl,storageMode:config.mode};
    store.putFolder(req.user.id,b.companyId,folderId,saved);res.status(b.create===true?201:200).json(saved);
  });
  router.post('/months/:id/name',...write,(req,res)=>{
    const b=req.body;companyFor(config,req.user,b.companyId);
    const entry=store.folders(req.user.id,b.companyId).find(m=>m.id===req.params.id);if(!entry)fail('FiBu-Eintrag nicht gefunden.',404);
    if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>120)fail('Name mit 1 bis 120 Zeichen angeben.',400);
    const saved={...entry,name:b.name.trim()};store.putFolder(req.user.id,b.companyId,entry.id,saved);res.json(saved);
  });
  router.get('/jobs',(req,res)=>{
    companyFor(config,req.user,req.query.companyId);
    res.json({jobs:store.list(req.user.id,req.query.companyId).filter(j=>config.mode!=='cloud'||typeof j.sourceMonthPath==='string')});
  });
  router.post('/jobs',...write,async(req,res)=>{
    const b=req.body,c=companyFor(config,req.user,b.companyId),month=config.mode==='cloud'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(b.month)?b.month:monthFromFolder(b.monthFolderPath);
    if(b.month&&b.month!==month)fail('Abweichender Monat.',400);
    if(b.folderId){const profile=store.folders(req.user.id,b.companyId).find(m=>m.id===b.folderId);if(!profile)fail('FiBu-Eintrag nicht gefunden.',404);if(profile.month!==month||profile.monthFolderPath!==b.monthFolderPath||profile.bankPdfPath!==b.bankPdfPath||JSON.stringify(profile.bankPdfPaths)!==JSON.stringify(b.bankPdfPaths)||(profile.bankDrivePath===true)!==(b.bankDrivePath===true))fail('FiBu-Pfade wurden geändert. Übersicht neu laden.',409);}
    if(config.mode==='cloud'){
      require('../fibu/onedrive').cleanPath(b.monthFolderPath,{empty:true});
      require('../fibu/onedrive').cleanPath(b.bankPdfPath);if(! /\.pdf$/i.test(b.bankPdfPath)||/_Astra(?:_|\.)/i.test(b.bankPdfPath))fail('Original-Bank-PDF wählen.',400);
      if(!ms.connected(req.user.id,b.companyId))fail('Microsoft zuerst verbinden.',409);
      const sourceBankNames=b.bankPdfPaths?require('../fibu/statements').paths(b.bankPdfPaths,b.bankPdfPath):undefined;if(sourceBankNames&&(b.bankDrivePath!==true||sourceBankNames[0]!==b.bankPdfPath||sourceBankNames.length>(c.bankAccounts?.length||1)))fail('Erster Kontoauszug stimmt nicht überein.',400);
      const job=store.enqueue(req.user.id,{sourceBankNames,requestedBy:req.user.email,companyId:b.companyId,folderId:b.folderId||undefined,month,sourceMonthPath:b.monthFolderPath,sourceBankName:b.bankPdfPath,sourceBankIsDrivePath:b.bankDrivePath===true,monthFolderPath:b.monthFolderPath,bankPdfPath:b.bankPdfPath,bankHash:null});
      if(b.folderId){const profile=store.folders(req.user.id,b.companyId).find(m=>m.id===b.folderId);if(profile?.completed)store.putFolder(req.user.id,b.companyId,b.folderId,{...profile,completed:false});}res.status(202).json(job);setImmediate(()=>cloud.run(job.id,job.owner,c));return;
    }
    if(config.mode==='remote') {
      if(typeof b.bankPdfPath!=='string'||b.bankPdfPath.length>2000||! /\.pdf$/i.test(b.bankPdfPath)||b.bankPdfPath.split(/[\\/]/).includes('..'))fail('Gültigen Bank-PDF-Pfad angeben.',400);
      const job=store.enqueue(req.user.id,{companyId:b.companyId,folderId:b.folderId||undefined,month,monthFolderPath:b.monthFolderPath,bankPdfPath:b.bankPdfPath,bankHash:null});
      return res.status(202).json(job);
    }
    const folder=await inside(c.root,b.monthFolderPath,'directory'),bank=await inside(folder,b.bankPdfPath);
    if(!/\.pdf$/i.test(bank)||/_Astra(?:_|\.)/i.test(bank))fail('Original-Bank-PDF auswählen.',400);
    const bytes=await fs.readFile(bank);if(bytes.subarray(0,5).toString()!=='%PDF-')fail('PDF ungültig.',400);
    const job=store.enqueue(req.user.id,{companyId:b.companyId,folderId:b.folderId||undefined,month,monthFolderPath:folder,bankPdfPath:bank,bankHash:hash(bytes)});
    res.status(202).json(job);
    setImmediate(()=>worker.run(job.id,job.owner,c));
  });
  router.get('/jobs/:id',(req,res)=>res.json(jobFor(req)));
  router.post('/jobs/:id/receipts',...write,async(req,res)=>{const job=jobFor(req),c=companyFor(config,req.user,job.companyId);if(config.mode!=='cloud'||job.execution!=='server'||store.hasActive(job.companyId,job.month)||store.isClosed(job.companyId,job.month,job.folderId))fail('Belegablage nur nach einem beendeten, offenen Serverlauf ergänzen.',409);try{await worker.exportResult(job,c);}finally{store.save(job);}res.json({publication:job.receiptPublication});});
  router.post('/jobs/:id/unassigned',...write,async(req,res)=>{const job=jobFor(req),c=companyFor(config,req.user,job.companyId);if(config.mode==='remote'||['queued','running'].includes(job.state))fail('Ordner nach einem beendeten Server-/Lokallauf erstellen.',409);try{await worker.exportUnassigned(job,c);}finally{store.save(job);}res.json({count:job.unassignedReview.count,published:job.unassignedReview.published,webUrl:job.unassignedReview.webUrl||null});});
  router.post('/jobs/:id/documents/:documentId/verify',...write,async(req,res)=>{
    const job=jobFor(req),c=companyFor(config,req.user,job.companyId);
    if(store.hasActive(job.companyId,job.month)||worker.running.has(job.id)||store.isClosed(job.companyId,job.month,job.folderId))fail('Monat läuft oder ist abgeschlossen.',409);
    if(store.month(job.owner,job.companyId,job.month,job.folderId)?.jobId!==job.id)fail('Nur den neuesten Prüflauf bearbeiten.',409);
    const d=job.documents.find(d=>d.id===req.params.documentId);if(!d)fail('Dokument fehlt.',404);
    require('../fibu/review').validateReview(req.body,c);
    if(config.mode==='remote'){job.pendingReview={type:'document',documentId:d.id,details:req.body};return res.status(202).json(store.save(job,'queued'));}
    store.save(job,'running');worker.running.add(job.id);
    try{await worker.verifyDocument(job,d,req.body,c,req.user.id);await worker.exportResult(job,c);store.save(job);res.json(job);}
    catch(e){job.issues.push('Belegprüfung unterbrochen; gespeicherte Bestätigung und Ausgabe prüfen.');store.save(job,'partial');throw e;}
    finally{worker.running.delete(job.id);}
  });
  router.post('/jobs/:id/pause',...write,(req,res)=>{
    const job=jobFor(req);companyFor(config,req.user,job.companyId);if(config.mode!=='cloud'||!['queued','running'].includes(job.state)||job.cancelRequested)fail('Nur laufende Serverprüfungen können pausiert werden.',409);
    res.json(store.control(job,true));
  });
  router.post('/jobs/:id/resume',...write,(req,res)=>{
    const job=jobFor(req),c=companyFor(config,req.user,job.companyId),interrupted=job.execution==='server'&&['partial','failed','waiting_for_user'].includes(job.state)&&job.workProgress?.percent<100;
    const paused=['queued','running'].includes(job.state)&&job.pauseRequested;
    if(config.mode!=='cloud'||(!paused&&!interrupted)||job.cancelRequested)fail('Dieser Lauf kann nicht fortgesetzt werden.',409);
    if(store.isClosed(job.companyId,job.month,job.folderId))fail('Monat zuerst wieder öffnen.',409);
    if(interrupted&&(store.hasActive(job.companyId,job.month)||cloud.running.has(job.id)||worker.running.has(job.id)))fail('Für diesen Monat läuft bereits eine Prüfung.',409);
    const saved=store.control(job,false);
    if(interrupted){saved.pausedMs=(saved.pausedMs||0)+Math.max(0,Date.now()-Date.parse(saved.updated));saved.runFinishedAt=null;saved.state='queued';store.save(saved,'queued');}
    if(!cloud.running.has(job.id)&&!worker.running.has(job.id)){saved.documents=[];saved.mailDocumentPaths=[];saved.events.push({at:new Date().toISOString(),message:'Fortsetzen nach Unterbrechung: Quellen werden erneut geprüft; verifizierte Ablagen werden wiederverwendet.'});store.save(saved);setImmediate(()=>cloud.run(job.id,job.owner,c));}
    res.status(202).json(store.get(job.owner,job.id));
  });
  router.post('/jobs/:id/cancel',...write,(req,res)=>{
    const job=jobFor(req);if(['queued','running'].includes(job.state)){job.cancelRequested=true;store.save(job);}res.json(job);
  });
  router.post('/jobs/:id/assign',...write,async(req,res)=>{
    const job=jobFor(req),c=companyFor(config,req.user,job.companyId);
    if(['queued','running'].includes(job.state)||worker.running.has(job.id))fail('Prüflauf arbeitet noch.',409);
    if(store.isClosed(job.companyId,job.month,job.folderId))fail('Monat zuerst wieder öffnen.',409);
    if(store.month(job.owner,job.companyId,job.month,job.folderId)?.jobId!==job.id)fail('Nur den neuesten gespeicherten Prüflauf bearbeiten.',409);
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
    const job=jobFor(req),m=store.month(job.owner,job.companyId,job.month,job.folderId);
    if(req.body.action==='close'&&companyFor(config,req.user,job.companyId).pilotMode===true)fail('Eine Pilot-Arbeitskopie kann keinen produktiven Monatsabschluss erhalten.',409);
    if(!m)fail('Noch kein geprüfter Monat.',409);
    if(worker.running.has(job.id)||store.hasActive(job.companyId,job.month))fail('Prüfung läuft noch.',409);
    if(!['close','reopen'].includes(req.body.action))fail('Aktion ungültig.',400);
    if(store.isClosed(job.companyId,job.month,job.folderId)&&!m.closed)fail('Der Monat wurde von einem anderen Benutzer abgeschlossen. Dieser muss ihn ausdrücklich wieder öffnen.',409);
    if(req.body.action==='close'&&(m.jobId!==job.id||job.issues.length||!job.transactions.length||job.transactions.some(t=>['missing','manual'].includes(t.status))))fail('Offene Belege/Fehler verhindern den Monatsabschluss.',409);
    job.events.push({at:new Date().toISOString(),message:req.body.action==='close'?'Monat ausdrücklich abgeschlossen':'Monat ausdrücklich wieder geöffnet'});
    store.putMonth(job.owner,job.companyId,job.month,m,req.body.action==='close',job.folderId);store.save(job);res.json({closed:req.body.action==='close'});
  });
  router.get('/jobs/:id/files/:kind',async(req,res)=>{
    const job=jobFor(req),c=companyFor(config,req.user,job.companyId);
    let file=req.params.kind==='original'?job.bankPdfPath:req.params.kind==='marked'?job.markedPdfPath:req.params.kind==='report'?job.reportPath:job.documents.find(d=>d.id===req.params.kind)?.path;
    const bankFile=req.params.kind.match(/^statement-([a-f0-9]{16})-(original|marked)$/);if(bankFile){const st=job.bankStatements?.find(s=>s.id===bankFile[1]);file=bankFile[2]==='original'?st?.bankPdfPath:st?.markedPdfPath;if(file&&bankFile[2]==='original'&&hash(await fs.readFile(await inside(c.root,file)))!==st.bankHash)fail('Original-Kontoauszug verändert.',409);}
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
  router.post('/microsoft/:companyId/probe',...write,async(req,res)=>{const c=companyFor(config,req.user,req.params.companyId,{allowDisabled:true});if(c.mailEnabled===false)fail('E-Mail-Prüfung ist für diese Firma deaktiviert.',409);res.json(await ms.probe(req.user.id,req.params.companyId,c.mailbox||'epost@testconsulting.de'));});
  router.post('/microsoft/:companyId/disconnect',...write,(req,res)=>{companyFor(config,req.user,req.params.companyId,{allowDisabled:true});ms.disconnect(req.user.id,req.params.companyId);res.json({connected:false});});
  router.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.status||422).json({error:err.status?err.message:'Dateizugriff oder Verarbeitung fehlgeschlagen. Konfiguration und Dateiberechtigungen prüfen.'});});
  router.runnerRouter=require('../fibu/runner-api').runnerApi({store,config,ms,db});
  return router;
};

const fs=require('node:fs/promises');
const path=require('node:path');
const {hash,inside,fail,monthFromFolder,classify,match,allocations,astraName,writeVerified}=require('./core');
const pdf=require('./pdf');
const {advance}=require('./progress');
function engine({store,config,ms}) {
  const running=new Set(),extractions=new Map();
  function extractReceipt(bytes,isPdf,c){
    const key=hash(bytes)+':'+(c.ocrEnabled===true);
    if(extractions.has(key)){const value=extractions.get(key);extractions.delete(key);extractions.set(key,value);return value;}
    const value=pdf.extractReceipt(bytes,isPdf,{ocr:c.ocrEnabled===true});extractions.set(key,value);
    if(extractions.size>128)extractions.delete(extractions.keys().next().value);
    return value;
  }
  async function validate(c,body) {
    const month=monthFromFolder(body.monthFolderPath);
    if(body.month&&body.month!==month) fail('Monat stimmt nicht mit dem Ordner überein.',400);
    const folder=await inside(c.root,body.monthFolderPath,'directory');
    const bank=await inside(folder,body.bankPdfPath);
    if(!/\.pdf$/i.test(bank)||/_Astra(?:_|\.)/i.test(bank)) fail('Unveränderte Original-Bank-PDF wählen.');
    const bytes=await fs.readFile(bank);
    if(bytes.subarray(0,5).toString()!=='%PDF-') fail('Bankdatei ist keine PDF.');
    const extracted=await pdf.extract(bytes);
    pdf.verifyStatement(extracted,c,month);
    const parsed=pdf.transactions(extracted,month,hash(bytes));
    return {month,monthFolderPath:folder,bankPdfPath:bank,bankHash:hash(bytes),...parsed};
  }
  const event=(job,message)=>{job.events.push({at:new Date().toISOString(),message});job.progress=message;store.save(job);};
  const checkpoint=job=>{if(store.get(job.owner,job.id)?.cancelRequested) throw Object.assign(new Error('Vom Nutzer abgebrochen; bereits erfolgte Ablagen stehen im Protokoll.'),{cancelled:true});};
  async function document(file,c,source={}) {
    const bytes=await fs.readFile(file),digest=hash(bytes),name=path.basename(file);
    const isPdf=/\.pdf$/i.test(file);
    if(!isPdf&&!c.ocrEnabled) return {id:digest,path:file,name,hash:digest,verified:false,amounts:[],text:'',reason:'Foto-/Bildbeleg: OCR/manuelle Prüfung erforderlich',...source};
    const extracted=await extractReceipt(bytes,isPdf,c);
    return {id:digest,path:file,name,hash:digest,...pdf.receiptMetadata(extracted,c),...(extracted.ocr?{ocr:extracted.ocr,requiresReview:true,reason:'OCR-Vorschlag: Firma, Betrag und Referenz am Original bestätigen'}:{}),...source};
  }
  async function importMail(job,c,collection) {
    if(!ms.connected(job.owner,job.companyId)) {job.issues.push('E-Post nicht verbunden; nur lokale Bestandsbelege geprüft.');return;}
    const mailbox=c.mailbox||'epost@testconsulting.de';
    const messages=await ms.list(job.owner,job.companyId,mailbox);
    if(ms.search)for(const ref of require('./mail-references').mailReferences(job.transactions)) {
      checkpoint(job);
      try{messages.push(...await ms.search(job.owner,job.companyId,mailbox,ref));}catch(e){job.issues.push('Historische Belegsuche: '+e.message);}
    }
    const uniqueMessages=[...new Map(messages.map(m=>[m.id,m])).values()];let mailDone=0;
    for(const message of uniqueMessages) {
      advance(job,store,'mail',mailDone++,uniqueMessages.length);
      checkpoint(job);
      const files=[],issues=[],attachments=await ms.attachments(job.owner,job.companyId,mailbox,message.id);
      let relevant=0;
      for(const a of attachments) {
        if(a.isInline && /logo|signature|signatur/i.test(a.name||'')) {event(job,'Inline-Signatur/Logo ausgelassen: '+a.name);continue;}
        if(!/\.(pdf|jpe?g|png)$/i.test(a.name||'')) {issues.push('Nicht klassifizierter Anhang: '+(a.name||a.id));continue;}
        relevant++;
        try {
          if(a['@odata.type']!=='#microsoft.graph.fileAttachment'||!a.contentBytes)fail('Anhang nicht herunterladbar.');
          const bytes=Buffer.from(a.contentBytes,'base64');
          if(bytes.length>25*1024*1024) fail('Anhang zu groß.');
          const isPdf=/\.pdf$/i.test(a.name);
          if(!isPdf&&!c.ocrEnabled)fail('Bildanhang benötigt OCR/manuelle Firmenprüfung; Nachricht bleibt offen.');
          if(isPdf&&bytes.subarray(0,5).toString()!=='%PDF-') fail('PDF-Signatur ungültig.');
          const extracted=await extractReceipt(bytes,isPdf,c);
          const meta=require('./review').applyReview(pdf.receiptMetadata(extracted,c),store.documentReview(job.owner,job.companyId,hash(bytes)),c);
          if(!meta.verified) fail('Firma im Anhang nicht eindeutig verifiziert; keine automatische Ablage.');
          const safe=s=>s.replace(/[^a-zA-Z0-9ÄÖÜäöüß.,_-]/g,'_').slice(0,70);
          const name=[meta.supplier&&safe(meta.supplier),meta.amounts.length===1&&`${meta.amounts[0].toFixed(2)}_EUR`,'Rechnung',meta.invoice&&safe(meta.invoice),meta.invoiceDate&&safe(meta.invoiceDate)].filter(Boolean).join('_')+(isPdf?'.pdf':path.extname(a.name).toLowerCase());
          let existingPath;const previousFile=store.mailFile?.(job.owner,job.companyId,hash(bytes));if(previousFile)try{const previousPath=await inside(c.root,previousFile.path);if(hash(await fs.readFile(previousPath))===hash(bytes))existingPath=previousPath;}catch{}
          const saved=existingPath||await writeVerified(collection,name==='Rechnung.pdf'?`Beleg_${hash(bytes).slice(0,12)}.pdf`:name,bytes);
          files.push({path:saved,hash:hash(bytes),originalName:a.name,messageId:message.id,attachmentId:a.id,at:new Date().toISOString()});
          // Persist provenance before any Outlook write; partial imports remain resumable.
          store.putMail(job.owner,job.companyId,message.id,{completed:false,files,issues});
          event(job,'E-Post-Anhang verifiziert abgelegt: '+path.basename(saved));
          if(extracted.ocr&&!meta.manualVerification)issues.push(a.name+': OCR-Ergebnis muss am Original bestätigt werden; Outlook bleibt offen.');
        }catch(e){issues.push((a.name||a.id)+': '+e.message);}
      }
      if(!issues.length&&relevant>0&&files.length===relevant) {
        if(c.pilotMode===true) {
          job.mailMarkingDeferred=true;
          store.putMail(job.owner,job.companyId,message.id,{completed:false,files,issues:[],markingDeferred:true});
          event(job,'Pilotimport verifiziert; Outlook-Markierung bleibt aus.');
        }else{
          try {await ms.complete(job.owner,job.companyId,mailbox,message.id);store.putMail(job.owner,job.companyId,message.id,{completed:true,files,issues:[]});}
          catch(e){issues.push('Ablage erfolgt, Outlook-Markierung fehlgeschlagen: '+e.message);}
        }
      }
      if(issues.length) {job.issues.push(...issues);store.putMail(job.owner,job.companyId,message.id,{completed:false,files,issues});}
    }
  }
  async function exportResult(job,c) {
    advance(job,store,'export');
    const folder=await inside(c.root,job.monthFolderPath,'directory');
    const bank=await inside(folder,job.bankPdfPath),bytes=await fs.readFile(bank);
    if(hash(bytes)!==job.bankHash) fail('Originalbank wurde seit dem Start verändert. Neue Revision erforderlich.');
    const output=await pdf.annotate(bytes,job.transactions);
    const reopened=await pdf.extract(output),original=await pdf.extract(bytes);
    if(reopened.pages.length!==original.pages.length||reopened.text!==original.text)fail('PDF-Prüfung: Text oder Seitenzahl verändert.');
    job.markedPdfPath=await writeVerified(folder,astraName(path.basename(bank)),output);
    if(job.execution==='server'&&ms.publishBank){try{await ms.publishBank(job,c,store);}catch(e){job.issues.push('OneDrive-PDF konnte nicht aktualisiert werden: '+(e.status?e.message:'Verbindung prüfen.'));}}
    try{await exportUnassigned(job,c);}catch{job.issues.push('Ordner für nicht zugewiesene Belege konnte nicht vollständig erstellt werden. Originaldateien bleiben erhalten.');}
    job.lastSuccessfulCheck=new Date().toISOString();
    job.state=job.issues.length?'partial':job.transactions.some(t=>['missing','manual'].includes(t.status))?'waiting_for_user':'completed';
    advance(job,store,'done');
    job.events.push({at:job.lastSuccessfulCheck,message:'Markierte PDF gespeichert und Text/Seitenzahl verifiziert; Ergebnis: '+job.state});
    job.reportPath=await writeVerified(folder,`ASTRA_Pruefbericht_${job.month}_${job.id}.json`,Buffer.from(JSON.stringify({...job,documents:job.documents.map(({text,...d})=>d)},null,2)));
    store.putMonth(job.owner,job.companyId,job.month,{execution:job.execution||'local',bankHash:job.bankHash,transactions:job.transactions,lastSuccessfulCheck:job.lastSuccessfulCheck,jobId:job.id},false,job.folderId);
  }
  async function exportUnassigned(job,c){await require('./unassigned').createReview(job,c);if(job.execution==='server'&&ms.publishUnassigned)await ms.publishUnassigned(job,c);}
  async function verifyDocument(job,d,body,c){
    const file=await inside(c.root,d.path);if(hash(await fs.readFile(file))!==d.hash)fail('Beleg wurde seit der Prüfung verändert.',409);
    const review={...require('./review').validateReview(body,c),checkedBy:job.owner,documentHash:d.hash};
    store.putDocumentReview(job.owner,job.companyId,d.hash,review);
    Object.assign(d,require('./review').applyReview(d,review,c));
    job.events.push({at:review.checkedAt,message:'Beleg am Original bestätigt: '+d.name+' · '+review.reason,documentHash:d.hash});
  }
  async function run(id,owner,c) {
    if(running.has(id))return;
    running.add(id);let job=store.get(owner,id);
    try {
      store.save(job,'running');job.state='running';checkpoint(job);
      const checked=await validate(c,job);
      if(checked.bankHash!==job.bankHash)fail('Bankdatei wurde nach Auftrag geändert.');
      job.transactions=checked.transactions;job.controls=checked.controls||null;job.issues.push(...checked.issues);
      const storedPrevious=store.month(owner,job.companyId,job.month,job.folderId),previous=job.execution==='server'&&storedPrevious?.execution!=='server'?null:storedPrevious;
      if(previous&&previous.bankHash!==job.bankHash)job.issues.push('Neue Bankrevision: frühere Zuordnungen bleiben in der Historie, Koordinaten müssen neu geprüft werden.');
      const collection=await inside(c.root,c.collectionFolder,'directory');
      event(job,'Bankkonto und Auszugszeitraum geprüft.');
      advance(job,store,'mail');
      try {await importMail(job,c,collection);}catch(e){job.issues.push('E-Post-Teilfehler: '+e.message);}
      const pending=path.join(job.monthFolderPath,'00_Nicht zugewiesene Belege');const scan=[];for(const folder of new Set([job.monthFolderPath,collection,...(await fs.stat(pending).then(s=>s.isDirectory()).catch(()=>false)?[pending]:[])]))for(const entry of await fs.readdir(folder,{withFileTypes:true}))scan.push({folder,entry});
      let scanned=0;for(const {folder,entry} of scan) {
          advance(job,store,'documents',scanned++,scan.length);
          checkpoint(job);
          if(!entry.isFile()||! /\.(pdf|jpe?g|png)$/i.test(entry.name)||/ASTRA_Pruefbericht/i.test(entry.name)||entry.name.startsWith(path.parse(job.bankPdfPath).name+'_Astra'))continue;
          const file=await inside(c.root,path.join(folder,entry.name));
          if(file===job.bankPdfPath)continue;
          try {
            let d=await document(file,c,{source:folder===collection?'collection':'month'});
            const provenance=store.imports(owner,job.companyId).find(i=>i.hash===d.hash);if(provenance)d.portalImport=provenance;
            d=require('./review').applyReview(d,store.documentReview(owner,job.companyId,d.hash),c);
            if(/Auszugszeitraum|Anfangssaldo|Endsaldo/i.test(d.text))continue;
            if(!job.documents.some(x=>x.hash===d.hash))job.documents.push(d);
          }catch(e){job.issues.push(entry.name+': '+e.message);}
        }
      // Include previously verified receipt paths, which now bear _Astra and are excluded from fresh scans.
      if(previous?.bankHash===job.bankHash) for(const old of previous.transactions||[]) for(const r of old.receipts||[]) {
          try {const file=await inside(c.root,r.path);if(hash(await fs.readFile(file))===r.hash&&!job.documents.some(d=>d.hash===r.hash)){const d=await document(file,c,{source:'previous'});job.documents.push(require('./review').applyReview(d,store.documentReview(owner,job.companyId,d.hash),c));}}
        catch{job.issues.push('Früherer Beleg nicht mehr verifiziert: '+r.name);}
      }
      const matchDocuments=require('./core').canonicalDocuments(job.documents);
      const crossGroups=require('./cross-check').qualifiedCrossChecks(job.transactions,matchDocuments,c);
      const paymentGroups=require('./payment-evidence').qualifiedPayments(job.transactions,matchDocuments,c);
      const candidates=new Map(job.transactions.map(t=>[t.id,match(t,matchDocuments)]));
      const groups=allocations(job.transactions,matchDocuments);
      let matched=0;for(const t of job.transactions) {
        advance(job,store,'match',matched++,job.transactions.length);
        checkpoint(job);Object.assign(t,classify(t,c));
        if(t.color==='purple'){t.status='not_required';continue;}
        const old=previous?.bankHash===job.bankHash&&previous.transactions?.find(x=>x.id===t.id);
        if(old?.manualDecision==='unmatched'){t.manualDecision='unmatched';t.status='manual';t.reason='Manuelle Aufhebung erhalten';continue;}
        let docs=candidates.get(t.id);
        const group=groups.find(g=>g.transactions.includes(t));
        const paymentGroup=!old?.manualDecision&&docs.length===0&&!group?paymentGroups.find(g=>g.transaction.id===t.id&&!g.documents.some(d=>[...candidates].some(([tid,list])=>tid!==t.id&&list.some(x=>x.id===d.id)))):null;
        const crossGroup=!old?.manualDecision&&!paymentGroup&&!group&&docs.length===0?crossGroups.find(g=>g.transactions.some(x=>x.id===t.id)&&!g.documents.some(d=>[...candidates].some(([tid,list])=>tid!==t.id&&list.some(x=>x.id===d.id)))):null;
        if(crossGroup)docs=crossGroup.documents;
        if(paymentGroup)docs=paymentGroup.documents;
        if(group)docs=group.documents;
        if(old?.manualDecision==='matched')docs=job.documents.filter(d=>old.receipts.some(r=>r.hash===d.hash));
        const shared=docs.some(d=>[...candidates].some(([tid,list])=>tid!==t.id&&list.some(x=>x.id===d.id)));
        if((group||paymentGroup||crossGroup||docs.length===1&&!shared)&&docs.length) {
          for(let i=0;i<docs.length;i++)await assign(job,t,docs[i],c,i>0);if(old?.manualDecision)t.manualDecision=old.manualDecision;
          if(crossGroup){t.matchEvidence=crossGroup.evidence;t.reason=crossGroup.reason;for(const d of crossGroup.documents)d.crossVerified={transactionId:t.id,evidence:crossGroup.evidence};}
          if(paymentGroup){t.matchEvidence=paymentGroup.evidence;t.reason='Rechnung und PayPal-Zahlungsnachweis: Referenz, Händler, Fremdwährungsbetrag, EUR-Abbuchung, Kontozuordnung und Zeitraum geprüft';paymentGroup.payment.linkedVerification={transactionId:t.id,invoiceDocumentId:paymentGroup.invoice.id};}
          if(group)t.reason='Referenzbasierte Teil-/Sammelzahlung, Gesamtsumme geprüft';
        } else if(docs.length) {t.status='manual';t.reason=shared?'Beleg passt zu mehreren Buchungen':'Mehrdeutige Belege';}
      }
      event(job,'Zuordnungen geprüft; markierte Kopie wird gespeichert.');checkpoint(job);
      await exportResult(job,c);
      advance(job,store,'done');
      job.state=job.issues.length?'partial':job.transactions.some(t=>['missing','manual'].includes(t.status))?'waiting_for_user':'completed';
      event(job,'Prüflauf beendet. Monatsabschluss erfordert eine eigene Freigabe.');store.save(job);
    }catch(e){job.issues.push(e.status||e.cancelled?e.message:'Verarbeitung fehlgeschlagen; Dateizugriff oder PDF prüfen.');job.progress=e.cancelled?'Abgebrochen':'Prüfung angehalten';store.save(job,e.cancelled?'cancelled':e.status===422?'waiting_for_user':'failed');}
    finally{running.delete(id);}
  }
  async function assign(job,t,d,c,append=false) {
    const source=await inside(c.root,d.path),bytes=await fs.readFile(source);
    if(hash(bytes)!==d.hash)fail('Beleg wurde verändert.');
    const folder=await inside(c.root,job.monthFolderPath,'directory');
    const saved=await writeVerified(folder,astraName(d.name),bytes);
    if(source!==saved) {
      // Complete a verified move/rename only after the destination hash is checked.
      if(hash(await fs.readFile(source))!==d.hash)fail('Originalbeleg hat sich während der Ablage geändert.');
      store.relocateMail(job.owner,job.companyId,d.hash,saved);
      const immutableImport=d.source==='import'||(d.portalImport?.path&&path.resolve(source)===path.resolve(d.portalImport.path));
      if(!immutableImport)try{await fs.unlink(source);}catch{job.issues.push('Zielablage verifiziert; Quellbeleg konnte nicht entfernt/umbenannt werden: '+path.basename(source));}
      d.originalPath=d.originalPath||source;d.originalName=d.originalName||d.name;d.path=saved;d.name=path.basename(saved);
    }
    t.receipts=[...(append?t.receipts:[]),{id:d.id,hash:d.hash,path:saved,name:path.basename(saved),assignedAt:new Date().toISOString()}];
    t.status='matched';if(!t.color)t.color='yellow';t.reason='Betrag und Referenz/Gegenpartei bzw. manuelle Bestätigung; Ablage verifiziert';
    job.events.push({at:new Date().toISOString(),message:'Belegablage verifiziert: '+t.id});
  }
  return {validate,run,exportResult,exportUnassigned,assign,verifyDocument,running};
}
module.exports={engine};

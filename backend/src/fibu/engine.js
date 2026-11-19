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
  async function importMail(job,c,collection){return require('./mail-import').importMail({job,c,collection,ms,store,event,checkpoint});}
  async function exportResult(job,c) {
    advance(job,store,'export');
    const folder=await inside(c.root,job.monthFolderPath,'directory');
    const bank=await inside(folder,job.bankPdfPath),bytes=await fs.readFile(bank);
    if(hash(bytes)!==job.bankHash) fail('Originalbank wurde seit dem Start verändert. Neue Revision erforderlich.');
    require('./rules').apply(job,c);
    await publishReceipts(job,c);
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
  async function publishReceipts(job,c){
    if(job.execution!=='server'||!ms.publishReceipts)return;
    try{await ms.publishReceipts(job,c);}catch(e){job.receiptPublication={verified:false,files:[],errors:job.transactions.filter(t=>t.status==='matched').flatMap(t=>t.receipts||[]).map(r=>({hash:r.hash,error:e.message}))};}
    if(!job.receiptPublication)job.receiptPublication={verified:false,files:[],errors:job.transactions.filter(t=>t.status==='matched').flatMap(t=>t.receipts||[]).map(r=>({hash:r.hash,error:'OneDrive-Ablage nicht bestätigt.'}))};
    const failed=new Set((job.receiptPublication?.errors||[]).map(e=>e.hash));if(failed.size){job.issues.push('Zugeordnete Belege konnten nicht vollständig im OneDrive-Zielordner verifiziert werden. Betroffene Buchungen bleiben zur Klärung offen.');for(const t of job.transactions)if(t.status==='matched'&&(t.receipts||[]).some(r=>failed.has(r.hash))){t.status='manual';if(t.color==='yellow')t.color=null;t.reason='Beleg gefunden, aber Ablage im OneDrive-Zielordner nicht verifiziert.';}}
  }
  async function exportUnassigned(job,c){await require('./unassigned').createReview(job,c);if(job.execution==='server'&&ms.publishUnassigned)await ms.publishUnassigned(job,c);}
  async function verifyDocument(job,d,body,c,actor=job.owner){
    const file=await inside(c.root,d.path);if(hash(await fs.readFile(file))!==d.hash)fail('Beleg wurde seit der Prüfung verändert.',409);
    const review={...require('./review').validateReview(body,c),checkedBy:actor,documentHash:d.hash};
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
      try {await importMail(job,c,await inside(c.root,c.mailCollectionFolder||c.collectionFolder,'directory'));}catch(e){job.issues.push('E-Post-Teilfehler: '+e.message);}
      const pending=path.join(job.monthFolderPath,'00_Nicht zugewiesene Belege');const scan=[];for(const folder of new Set([job.monthFolderPath,collection,...(await fs.stat(pending).then(s=>s.isDirectory()).catch(()=>false)?[pending]:[])]))for(const entry of await fs.readdir(folder,{withFileTypes:true}))scan.push({folder,entry});
      for(const file of job.mailDocumentPaths||[])if(!scan.some(s=>path.join(s.folder,s.entry.name)===file))scan.push({folder:path.dirname(file),entry:{name:path.basename(file),isFile:()=>true},mail:true});
      let scanned=0;for(const {folder,entry,mail} of scan) {
          advance(job,store,'documents',scanned++,scan.length);
          checkpoint(job);
          if(!entry.isFile()||! /\.(pdf|jpe?g|png)$/i.test(entry.name)||/ASTRA_Pruefbericht/i.test(entry.name)||entry.name.startsWith(path.parse(job.bankPdfPath).name+'_Astra'))continue;
          const file=await inside(c.root,path.join(folder,entry.name));
          if(file===job.bankPdfPath)continue;
          try {
            let d=await document(file,c,{source:mail||folder===collection?'collection':'month'});
            const provenance=store.imports(owner,job.companyId).find(i=>i.hash===d.hash);if(provenance)d.portalImport=provenance;
            d=require('./review').applyReview(d,store.documentReview(owner,job.companyId,d.hash),c);
            if(/Auszugszeitraum|Anfangssaldo|Endsaldo/i.test(d.text))continue;
            if(!job.documents.some(x=>x.hash===d.hash))job.documents.push(d);
          }catch(e){job.issues.push(entry.name+': '+e.message);}
        }
      // Include previously verified receipt paths, which now bear _Astra and are excluded from fresh scans.
      if(job.execution!=='server'&&previous?.bankHash===job.bankHash) for(const old of previous.transactions||[]) for(const r of old.receipts||[]) {
          try {const file=await inside(c.root,r.path);if(hash(await fs.readFile(file))===r.hash&&!job.documents.some(d=>d.hash===r.hash)){const d=await document(file,c,{source:'previous'});job.documents.push(require('./review').applyReview(d,store.documentReview(owner,job.companyId,d.hash),c));}}
        catch{job.issues.push('Früherer Beleg nicht mehr verifiziert: '+r.name);}
      }
      const matchDocuments=require('./core').canonicalDocuments(job.documents);
      const matchingTransactions=job.transactions.filter(t=>!classify(t,c).skipReceipt&&classify(t,c).color!=='purple');
      const crossGroups=require('./cross-check').qualifiedCrossChecks(matchingTransactions,matchDocuments,c);
      const paymentGroups=require('./payment-evidence').qualifiedPayments(matchingTransactions,matchDocuments,c);
      const candidates=new Map(job.transactions.map(t=>[t.id,classify(t,c).skipReceipt||classify(t,c).color==='purple'?[]:match(t,matchDocuments)]));
      const groups=allocations(job.transactions.filter(t=>!classify(t,c).skipReceipt&&classify(t,c).color!=='purple'),matchDocuments);
      let matched=0;for(const t of job.transactions) {
        advance(job,store,'match',matched++,job.transactions.length);
        checkpoint(job);Object.assign(t,classify(t,c));
        if(t.color==='purple'||t.skipReceipt){t.status='not_required';t.receipts=[];t.reason=t.rule;continue;}
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

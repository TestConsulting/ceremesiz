const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const {hash,monthFromFolder,classify,match,allocations,inside,writeVerified,astraName}=require('../src/fibu/core');
const pdf=require('../src/fibu/pdf');
const {createStore}=require('../src/fibu/store');
const {engine}=require('../src/fibu/engine');
const company={enabled:true,accountHolder:'TestConsulting CC GmbH',documentCompanyName:'TestConsulting CC GmbH',iban:'DE02120300000000202051',allowedUsers:['pilot@example.invalid'],payrollExceptions:true,greenCounterparties:['Hays','RCI Allemagne','C. Brettschneider GmbH Kartonagenfabrik','FC Moto']};
async function makePdf(lines){const {PDFDocument}=await import('../vendor/pdf-lib.mjs');const d=await PDFDocument.create(),p=d.addPage([900,842]);lines.forEach((s,i)=>p.drawText(s,{x:35,y:790-i*25,size:11}));return Buffer.from(await d.save());}
const bankLines=['TestConsulting CC GmbH','IBAN DE02120300000000202051','Auszugszeitraum: 01.10.2026 bis 31.10.2026','Anfangssaldo 1.000,00 EUR',
 '12.10.2026 Microsoft | Rechnung G194101447 -136,45 EUR','16.10.2026 PayCenter | Sachbezugsabrechnung 09/2026 -30,00 EUR','20.10.2026 Hays | Rechnung HAYS12345 +500,00 EUR','21.10.2026 Mitarbeiter | Kto Lohn -2.000,00 EUR','Endsaldo 333,55 EUR'];
const receiptLines=['Microsoft','Rechnungssteller: Microsoft','TestConsulting CC GmbH','Rechnungsnummer: G194101447','Rechnungsdatum: 08.10.2026','Gesamtbetrag: 136,45 EUR'];
test('Monat, Farbregeln und Belegstatus sind getrennt und konservativ',()=>{
 assert.equal(monthFromFolder('Z:\\Firma\\2026\\10'),'2026-10');assert.throws(()=>monthFromFolder('2026/13'));assert.throws(()=>monthFromFolder('2026/10/other'));
 assert.equal(classify({counterparty:'Hays',description:'Rechnung',amount:500},company).color,'green');
 assert.equal(classify({counterparty:'Hays AG',description:'Rechnung',amount:500},company).color,'green');
 assert.equal(classify({counterparty:'Hays',description:'Rechnung',amount:-500},company).color,null);
 assert.equal(classify({counterparty:'Andere',description:'Hays Referenz',amount:500},company).color,null);
 assert.equal(classify({description:'PayCenter Sachbezugsabrechnung 09/2026',amount:-30},company).color,null);
 assert.equal(classify({description:'Sachbezugskarten-Aufladung',amount:-50},company).color,'purple');
 assert.equal(classify({description:'PayCenter Gmbh Steuerfreie Sachleistung Sachbezugkarte Au fl adung - Jens',amount:-50},company).color,'purple');
 assert.equal(classify({description:'Vorschuss DATUM 12.10.2026 | ECHTZEIT-UEBERWEISUNG',amount:-200},company).color,'purple');
 assert.equal(classify({description:'Dominik Lapp VWL',amount:-40},company).color,'purple');
 assert.equal(classify({description:'Kto Lohn',amount:-100}, {...company,payrollExceptions:false}).color,null);
 assert.equal(match({amount:-136.45,description:'ohne Referenz',counterparty:''},[{verified:true,amounts:[136.45],text:'Rechnung',supplier:'Microsoft'}]).length,0);
 assert.equal(match({amount:-136.45,description:'INV12345',counterparty:''},[{verified:true,amounts:[136.45,100],text:'INV12345',supplier:'Microsoft'}]).length,0);
 assert.equal(astraName('Rechnung_Astra_Astra.pdf'),'Rechnung_Astra.pdf');
 const receipt={verified:true,invoice:'INV12345',amounts:[100]},parts=[{description:'INV12345',amount:-60},{description:'INV12345',amount:-40}];
 assert.equal(allocations(parts,[receipt]).length,1);assert.equal(allocations([...parts,{description:'INV12345',amount:-40}],[receipt]).length,0);
 assert.equal(allocations([{description:'INV12345 INV67890',amount:-150}],[receipt,{verified:true,invoice:'INV67890',amounts:[50]}]).length,1);
 assert.deepEqual(pdf.receiptMetadata({text:'TestConsulting CC GmbH\nGesamtbetrag: 136,45 USD'},company).amounts,[]);
 const msInvoice='Microsoft Ireland Operations Ltd\nTestConsulting CC GmbH\nRechnungsnummer: INV12345\n31,50 EUR\nFälligkeitsdatum: 02/10/2026 Summe: 31,50';
 assert.deepEqual(pdf.receiptMetadata({text:msInvoice},company).amounts,[31.5]);
 assert.deepEqual(pdf.receiptMetadata({text:msInvoice.replace('Summe: 31,50','Summe: 32,50')},company).amounts,[]);
});
test('Pfade, exklusive Ablage und Mandantensperre',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'fibu-path-'));
 const db=new Database(':memory:');
 try{
  const root=path.join(tmp,'root');await fs.mkdir(root);const out=path.join(tmp,'outside.pdf');await fs.writeFile(out,'private');
  await assert.rejects(inside(root,'../outside.pdf'));await assert.rejects(inside(root,out));
  const a=await writeVerified(root,'Beleg.pdf',Buffer.from('one')),b=await writeVerified(root,'Beleg.pdf',Buffer.from('two'));assert.notEqual(a,b);assert.equal(await fs.readFile(a,'utf8'),'one');
  assert.equal(await writeVerified(root,'Beleg.pdf',Buffer.from('one')),a);
  const store=createStore(db),params={companyId:'tc',month:'2026-10'};
  const j=store.enqueue(1,params);assert.equal(store.enqueue(1,params).id,j.id);assert.throws(()=>store.enqueue(2,params));assert.equal(store.get(2,j.id),null);
  store.save(j,'completed');store.putMonth(1,'tc','2026-10',{},true);assert.throws(()=>store.enqueue(1,params));assert.throws(()=>store.enqueue(2,params));
  store.putMonth(1,'tc','2026-10',{},false);const next=store.enqueue(1,params);assert.notEqual(next.id,j.id);store.recover();assert.equal(store.get(1,next.id).state,'partial');
 }finally{db.close();await fs.rm(tmp,{recursive:true,force:true});}
});
test('Junction-/Symlink-Ausbruch wird abgewiesen, falls die Umgebung das Anlegen erlaubt',async t=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'fibu-link-'));
 try{
  const root=path.join(tmp,'root'),other=path.join(tmp,'other');await fs.mkdir(root);await fs.mkdir(other);await fs.writeFile(path.join(other,'secret.pdf'),'secret');
  try{await fs.symlink(other,path.join(root,'link'),process.platform==='win32'?'junction':'dir');}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('Windows-Sandbox erlaubt kein Anlegen von Junctions/Symlinks.');return;}throw e;}
  await assert.rejects(inside(root,path.join(root,'link','secret.pdf')));
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test('Echter PDF-Abgleich mit synthetischen Belegen, Wiederholung und Mail-Teilfehler',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'fibu-e2e-')),db=new Database(':memory:');
 try{
  const folder=path.join(tmp,'2026','10'),collection=path.join(tmp,'collection');await fs.mkdir(folder,{recursive:true});await fs.mkdir(collection);
  const c={...company,root:tmp,collectionFolder:collection},config={mode:'local',companies:{tc:c}};
  const bank=await makePdf(bankLines),invoice=await makePdf(receiptLines),bankFile=path.join(folder,'Sparkasse.pdf');
  await fs.writeFile(bankFile,bank);await fs.writeFile(path.join(folder,'Microsoft.pdf'),invoice);
  const store=createStore(db),worker=engine({store,config,ms:{connected:()=>false}});
  const params={companyId:'tc',...await worker.validate(c,{monthFolderPath:folder,bankPdfPath:bankFile})};
  assert.equal(params.month,'2026-10');assert.equal(params.transactions.length,4);
  const job=store.enqueue(1,params);await worker.run(job.id,1,c);const result=store.get(1,job.id);
  assert.equal(result.state,'partial');assert.equal(result.transactions[0].status,'matched');assert.equal(result.transactions[0].color,'yellow');
  assert.equal(result.transactions[1].status,'missing');assert.equal(result.transactions[1].color,null);
  assert.equal(result.transactions[2].status,'missing');assert.equal(result.transactions[2].color,'green');
  assert.equal(result.transactions[3].status,'not_required');assert.equal(result.transactions[3].color,'purple');
  assert.ok(result.transactions[0].receipts[0].name.endsWith('_Astra.pdf'));assert.ok(result.lastSuccessfulCheck);
  assert.equal(hash(await fs.readFile(bankFile)),hash(bank));
  const marked=await fs.readFile(result.markedPdfPath);assert.equal((await pdf.extract(marked)).text,(await pdf.extract(bank)).text);
  const {PDFDocument}=await import('../vendor/pdf-lib.mjs');assert.equal((await PDFDocument.load(marked)).getPageCount(),1);
  const repeat=store.enqueue(1,params);await worker.run(repeat.id,1,c);const again=store.get(1,repeat.id);
  assert.equal(again.markedPdfPath,result.markedPdfPath);assert.equal(again.transactions[0].receipts[0].path,result.transactions[0].receipts[0].path);
  const wrong=await makePdf(bankLines.map(s=>s.replace('DE02120300000000202051','DE99999999999999999999')));await fs.writeFile(path.join(folder,'wrong.pdf'),wrong);
  await assert.rejects(worker.validate(c,{monthFolderPath:folder,bankPdfPath:path.join(folder,'wrong.pdf')}),/Kontoinhaber oder IBAN/);
  const wrongReceipt=await makePdf(receiptLines.map(s=>s.replace('TestConsulting CC GmbH','AC Immo Invest GmbH')));
  let completed=0;
  const ms={connected:()=>true,list:async()=>[{id:'mail',categories:['Bestehend']}],attachments:async()=>[
    {'@odata.type':'#microsoft.graph.fileAttachment',id:'a',name:'invoice.pdf',contentBytes:invoice.toString('base64')},
    {'@odata.type':'#microsoft.graph.fileAttachment',id:'b',name:'other.pdf',contentBytes:wrongReceipt.toString('base64')}],complete:async()=>completed++};
  const mailWorker=engine({store,config,ms}),mailJob=store.enqueue(1,params);await mailWorker.run(mailJob.id,1,c);
  assert.equal(completed,0);assert.equal(store.mail(1,'tc','mail').completed,false);assert.equal(store.mail(1,'tc','mail').files.length,1);
  assert.match(store.get(1,mailJob.id).issues.join(' '),/Firma/);
  ms.attachments=async()=>[{'@odata.type':'#microsoft.graph.fileAttachment',id:'a',name:'invoice.pdf',contentBytes:invoice.toString('base64')}];
  const mailOk=store.enqueue(1,params);await mailWorker.run(mailOk.id,1,c);assert.equal(completed,1);assert.equal(store.mail(1,'tc','mail').completed,true);
  c.pilotMode=true;ms.list=async()=>[{id:'pilot-mail'}];
  const pilotJob=store.enqueue(1,params);await mailWorker.run(pilotJob.id,1,c);
  assert.equal(completed,1);assert.equal(store.mail(1,'tc','pilot-mail').completed,false);assert.equal(store.mail(1,'tc','pilot-mail').markingDeferred,true);assert.equal(store.get(1,pilotJob.id).mailMarkingDeferred,true);
 }finally{db.close();await fs.rm(tmp,{recursive:true,force:true});}
});

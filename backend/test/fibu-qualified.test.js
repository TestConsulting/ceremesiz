const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/fibu/core'),payment=require('../src/fibu/payment-evidence');
const company={iban:'DE00000000000000004831'};
const invoiceText='Invoice\nExample Software Pty Ltd\nInvoice number: IN-EU-12345\nInvoice date: Oct 29, 2026\nInvoice Total: USD 106.62\nAmount paid via PayPal: USD 106.62';
const paymentText='Sie haben eine Zahlung gesendet\nHändler Example Software US Inc\nBestellnummer IN-EU-12345\nGesamtbetrag 106,62 $ USD\nGirokonto ••4831 99,96 € EUR\nTransaktionscode: ABCDE123456789\nTransaktionsdatum 29.10.2026';
function fixture(){return {docs:[{id:'i',verified:true,evidence:payment.metadata(invoiceText)},{id:'p',evidence:payment.metadata(paymentText)}],tx:[{id:'t',amount:-99.96,currency:'EUR',date:'2026-10-30',counterparty:'PayPal Europe',description:'PayPal Example Software'}]};}
test('Fremdwährungsbeleg benötigt unabhängigen vollständigen Zahlungsnachweis und eindeutige Bankbuchung',()=>{
 const {docs,tx}=fixture();assert.ok(docs.every(d=>d.evidence));assert.equal(payment.qualifiedPayments(tx,docs,company).length,1);
 for(const change of [d=>d[1].evidence.reference='IN-OTHER',d=>d[1].evidence.sourceAmount=106.63,d=>d[1].evidence.accountSuffix='9999',d=>d[1].evidence.merchant='other',d=>d[0].requiresReview=true]){const f=fixture();change(f.docs);assert.equal(payment.qualifiedPayments(f.tx,f.docs,company).length,0);}
 assert.equal(payment.qualifiedPayments([...tx,{...tx[0],id:'other'}],docs,company).length,0);
 assert.equal(payment.qualifiedPayments([{...tx[0],date:'2026-11-15'}],docs,company).length,0);
 assert.equal(payment.metadata(paymentText.replace('Sie haben eine Zahlung gesendet','Sie haben eine Zahlung autorisiert')),null);
 assert.equal(payment.metadata(paymentText+'\nStatus: Zahlung ausstehend'),null);
 assert.equal(payment.metadata('Sie haben eine Zahlung gesendet\nInhalt der Zahlungsmitteilung\nSie haben eine Zahlung autorisiert'),null);
});
test('Rechnungsreferenz hat Vorrang vor wiederholter Kundennummer, ohne Fuzzy-Ziffernvergleich',()=>{
 const tx={amount:-100,description:'Rechnung INV12345 Kunde 123456789',counterparty:'Vendor'},doc={id:'a',verified:true,amounts:[100],invoice:'INV12345',text:'INV12345 123456789',supplier:'Vendor'};
 assert.deepEqual(core.match(tx,[doc,{...doc,id:'b',invoice:'INV99999',text:'INV99999 123456789'}]).map(d=>d.id),['a']);
 assert.equal(core.match({...tx,description:'INV12346',counterparty:''},[doc]).length,0);
 const outgoing={...doc,invoice:'246',direction:'outgoing',customer:'Customer GmbH'};
 assert.equal(core.match({amount:100,description:'246',counterparty:'Customer GmbH'},[outgoing]).length,1);
 assert.equal(core.match({amount:100,description:'246',counterparty:'Other GmbH'},[outgoing]).length,0);
 assert.equal(core.match({amount:-100,description:'246',counterparty:'Customer GmbH'},[outgoing]).length,0);
 assert.equal(core.canonicalDocuments([{id:'a',text:'Invoice 123\nTotal 100'},{id:'b',text:'Invoice 123 Total 100'},{id:'c',text:'Invoice 123 Total 101'}]).length,2);
});
test('OCR-Kreuzprüfung lehnt Betrag allein und konkurrierende Bankzeilen ab',()=>{
 const {qualifiedCrossChecks}=require('../src/fibu/cross-check');const tx={id:'t',amount:-90.8,currency:'EUR',counterparty:'ExampleMarket',description:'ExampleMarket 123456789012'};
 const doc={id:'d',hash:'h',verified:true,requiresReview:true,ocr:{confidence:80},text:'ExampleMarket 123456789012 Betrag EUR 90,80 Brutto 90,80'};
 assert.equal(qualifiedCrossChecks([tx],[doc],company).length,1);
 assert.equal(qualifiedCrossChecks([{...tx,description:'ExampleMarket'}],[doc],company).length,0);
 assert.equal(qualifiedCrossChecks([tx,{...tx,id:'u'}],[doc],company).length,0);
 assert.equal(qualifiedCrossChecks([tx],[{...doc,verified:false}],company).length,0);
 assert.equal(qualifiedCrossChecks([tx],[{...doc,ocr:{confidence:30}}],company).length,0);
});
test('Engine legt Rechnung und Zahlungsnachweis zusammen ab und markiert die EUR-Bankbuchung',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),Database=require('better-sqlite3');const root=await fs.mkdtemp(path.join(os.tmpdir(),'astra-payment-')),db=new Database(':memory:');
 try{const {PDFDocument}=await import('../vendor/pdf-lib.mjs');async function pdf(text){const doc=await PDFDocument.create(),p=doc.addPage([900,842]);text.split('\n').forEach((l,i)=>p.drawText(l,{x:25,y:800-i*25,size:10}));return Buffer.from(await doc.save());}
 const folder=root+'/2026/10';await fs.mkdir(folder,{recursive:true});await fs.mkdir(root+'/collection');
 await fs.writeFile(folder+'/Bank.pdf',await pdf('TestConsulting CC GmbH\nIBAN DE00000000000000004831\nAuszugszeitraum: 01.10.2026 bis 31.10.2026\n30.10.2026 PayPal Europe | Example Software -99,96 EUR'));
 await fs.writeFile(root+'/collection/Invoice.pdf',await pdf(invoiceText+'\nTestConsulting CC GmbH'));
 await fs.writeFile(root+'/collection/Payment.pdf',await pdf(paymentText.replace('••','')));
 const c={...company,root,collectionFolder:'collection',documentCompanyName:'TestConsulting CC GmbH',accountHolder:'TestConsulting CC GmbH'},store=require('../src/fibu/store').createStore(db),worker=require('../src/fibu/engine').engine({store,config:{pilotMode:true},ms:{connected:()=>false}}),checked=await worker.validate(c,{monthFolderPath:folder,bankPdfPath:folder+'/Bank.pdf'}),job=store.enqueue(1,{companyId:'tc',...checked});await worker.run(job.id,1,c);const result=store.get(1,job.id),t=result.transactions[0];assert.equal(t.status,'matched');assert.equal(t.color,'yellow');assert.equal(t.receipts.length,2);assert.equal(t.matchEvidence.type,'invoice_payment_chain');assert.ok(result.documents.some(d=>d.linkedVerification));
 }finally{db.close();await fs.rm(root,{recursive:true,force:true});}
});
test('Historische Mail-Suche nutzt Rechnungsreferenzen statt beliebiger Kontonummern',()=>{
 const refs=require('../src/fibu/mail-references').mailReferences([{counterparty:'Vendor',description:'Rechnungs-Nr. INV-12345 IBAN DE12345678901234567890'},{counterparty:'Vendor',description:'Invoice number: INV-12345'},{counterparty:'Vendor',description:'Rechnungsnummer 00099204/16'},{counterparty:'Staff',description:'Kto Lohn 123456789'},{counterparty:'Hays AG',description:'HAYS12345'}]);
 assert.deepEqual(refs,['INV-12345','00099204/16','HAYS12345']);assert.equal(require('../src/fibu/mail-references').mailReferences(Array.from({length:50},(_,i)=>({description:'Rechnung INV'+(10000+i)}))).length,40);
});
test('AAG-Sammelbescheid braucht hochaufgelöstes Datum, Postmonat und vollständige Summenkontrolle',()=>{
 const {reimbursements}=require('../src/fibu/reimbursements');const doc={id:'d',hash:'h',verified:true,requiresReview:true,ocr:{confidence:85,header:{confidence:82,text:'Datum 21.10.2026'}},text:'BARMER\nDV 10.26\nAufwendungsausgleichsgesetz (AAG)\nErstattungsbetrag €\nÜB -100,00\nÜB -200,00\nSumme: -300,00\nDer Betrag wird auf Ihr Konto überwiesen.'};const tx=[100,200].map((amount,i)=>({id:String(i),amount,currency:'EUR',date:'2026-10-22',counterparty:'BARMER Ersatzkasse',description:'ERSTATTUNG NACH AAG'}));
 assert.equal(reimbursements(tx,[doc]).length,1);assert.equal(reimbursements(tx.slice(0,1),[doc]).length,0);assert.equal(reimbursements(tx,[{...doc,text:doc.text.replace('-300,00','-301,00')}]).length,0);assert.equal(reimbursements(tx,[{...doc,ocr:{...doc.ocr,header:{confidence:82,text:'Datum 21.10.2025'}}}]).length,0);assert.equal(reimbursements([...tx,{...tx[0],id:'dup'}],[doc]).length,0);
});
test('Anonymer Kartenbeleg braucht Terminal, Zeitstempel, Händler und wiederholten EUR-Betrag',()=>{
 const {qualifiedCrossChecks}=require('../src/fibu/cross-check');const tx={id:'t',amount:-90.8,currency:'EUR',date:'2026-10-21',counterparty:'ExampleMarket',description:'ExampleMarket ELV65264107 19.10 18.31 SEPA-ELV-LASTSCHRIFT'},doc={id:'d',hash:'h',requiresReview:true,verified:false,ocr:{confidence:75},text:'ExampleMarket\n6526410713442610191831\nTerminal-ID 65264107\nBetrag EUR 90,80\nBrutto 90,80'};
 assert.equal(qualifiedCrossChecks([tx],[doc],company).length,1);assert.equal(qualifiedCrossChecks([{...tx,description:tx.description.replace('18.31','18.32')}],[doc],company).length,0);assert.equal(qualifiedCrossChecks([tx],[{...doc,text:doc.text.replace('Brutto 90,80','Brutto 99,80')}],company).length,0);
});
test('Anbietergebundene Bankreferenzen erschließen historische Rechnungen ohne allgemeine Zahlensuche',()=>{
 const {mailReferences}=require('../src/fibu/mail-references');const tx=[{counterparty:'Microsoft Payments',description:'Microsoft.G189217557'},{counterparty:'Microsoft Payments',description:'MSFT . E08010GD6A'},{counterparty:'AMAZON PAYMENTS EUROPE S.C.A.',description:'303-8972509-7999504 AMZN Mktp DE'},{counterparty:'STRATO GmbH',description:'DRP 160310003 78282336'},{counterparty:'Telefonica Germany GmbH + Co. OHG',description:'Rg-Nr.: 1672248670/8'},{counterparty:'Steuerberater Handels Hinze Schutz',date:'2026-10-30',description:'ReNr: 5875/19.10.26'}];
 assert.deepEqual(mailReferences(tx),['G189217557','E08010GD6A','303-8972509-7999504','DRP160310003','1672248670/8','1672248670','2026/5875']);
 assert.deepEqual(mailReferences(tx.map(t=>({...t,counterparty:'Unbekannter Empfänger'}))),['1672248670/8']);
 assert.deepEqual(mailReferences([{counterparty:'Microsoft Payments',description:'DE02120300000000202051 1.000,00 EUR'}]),[]);
});

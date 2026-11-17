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
test('PDF-Fassungen derselben Kartenrechnung brauchen vollständig identische Zahlungsidentität',()=>{
 const {canonicalDocuments}=require('../src/fibu/core');const a={id:'a',text:'Rechnungsfassung A',verified:true,invoice:'INV12345',amounts:[134.9],cardEvidence:{timestamp:'2026-10-21T22:38',reference:'33949851-144637314',tender:'5Ysyx36CSgqi',merchantId:'100000000086308',issuerVat:'DE254615074'}},b={...a,id:'b',text:'Rechnungsfassung B'};
 assert.equal(canonicalDocuments([structuredClone(a),structuredClone(b)]).length,1);
 for(const field of ['reference','tender','merchantId','issuerVat','timestamp'])assert.equal(canonicalDocuments([structuredClone(a),{...structuredClone(b),cardEvidence:{...b.cardEvidence,[field]:'different'}}]).length,2);
 assert.equal(canonicalDocuments([structuredClone(a),{...structuredClone(b),amounts:[135]}]).length,2);assert.equal(canonicalDocuments([structuredClone(a),{...structuredClone(b),requiresReview:true}]).length,2);assert.equal(canonicalDocuments([structuredClone(a),{...structuredClone(b),text:'Stornorechnung'}]).length,2);
});
test('Fortschritt zeigt nach abgeschlossener Nachzuordnung beendet, während echter Veröffentlichung weiter laufend',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require('node:path').join(__dirname,'../private/fibu.js'),'utf8'),fn=source.slice(source.indexOf('function fibuProgress('),source.indexOf('async function viewFibu(')),progress=vm.runInNewContext(fn+'\nfibuProgress',{esc:String,Date});const job={state:'partial',workProgress:{percent:100,stage:'publish',label:'OneDrive-PDF aktualisieren',startedAt:'2026-10-01T10:00:00Z',updatedAt:'2026-10-01T10:01:00Z'}};
 assert.match(progress(job),/Prüfung beendet/);assert.doesNotMatch(progress(job),/OneDrive-PDF aktualisieren/);assert.match(progress({...job,state:'running'}),/OneDrive-PDF aktualisieren/);
});
test('Private Kartenquittung bleibt bis zur begründeten Firmenbestätigung ungeprüft und passt danach anhand der Kartenzeit',()=>{
 const pdf=require('../src/fibu/pdf'),{applyReview}=require('../src/fibu/review'),text='junited AUTOGLAS\nKUGLA Autoglas GmbH\nHerr Privatkunde\n23.10.2026\nKartenzahlung\n23.10, 13: 09\nAS-Zeit\n150,00\nBetrag EUR\nZahlung erfolgt',c={documentCompanyName:'TestConsulting CC GmbH'},raw=pdf.receiptMetadata({text},c),tx={amount:-150,description:'KUGLA 2026-10-23T13:09 | KARTENZAHLUNG',counterparty:'KUGLA Autoglas GmbH/Adresse/DE'};
 assert.equal(raw.verified,false);assert.deepEqual(raw.amounts,[150]);assert.equal(core.match(tx,[raw]).length,0);
 const approved=applyReview(raw,{companyName:c.documentCompanyName,amount:150,supplier:'KUGLA Autoglas GmbH',invoice:'ORDER12345',invoiceDate:'2026-10-23',reason:'Privater Empfänger geprüft, Firmenzuordnung bestätigt'},c);assert.equal(core.match(tx,[approved]).length,1);assert.equal(core.match({...tx,description:tx.description.replace('13:09','13:10')},[approved]).length,0);
});
test('Tank-Erstattung nutzt nur bereits am Original bestätigte Belege und verwirft Mehrdeutigkeiten',()=>{
 const {confirmedFuelReimbursements}=require('../src/fibu/approved-expenses'),doc={id:'d',hash:'h',verified:true,requiresReview:false,manualVerification:{reason:'Nutzer bestätigt Firmenzuordnung'},invoiceDate:'2026-10-18',invoice:'1593/003/00002',amounts:[137.01],text:'Aral Tankstelle Diesel'},tx={id:'t',date:'2026-10-20',amount:-137.01,currency:'EUR',counterparty:'Mitarbeiter',description:'Erstattung Tankbeleg'};
 assert.equal(confirmedFuelReimbursements([tx],[doc]).length,1);assert.equal(confirmedFuelReimbursements([tx],[{...doc,manualVerification:null}]).length,0);assert.equal(confirmedFuelReimbursements([tx],[{...doc,verified:false}]).length,0);assert.equal(confirmedFuelReimbursements([{...tx,date:'2026-11-20'}],[doc]).length,0);assert.equal(confirmedFuelReimbursements([tx,{...tx,id:'other'}],[doc]).length,0);assert.equal(confirmedFuelReimbursements([tx],[doc,{...doc,id:'other'}]).length,0);assert.equal(confirmedFuelReimbursements([{...tx,description:'andere Überweisung'}],[doc]).length,0);
});
test('Urban Sports: Rechnungsreferenz verbindet die richtige Monatsrechnung trotz gleicher Beträge',()=>{
 const pdf=require('../src/fibu/pdf'),text='TestConsulting CC GmbH\nDatum 24.09.2026\nKundennummer 1755300\nRechnung 1755300-444135\nVielen Dank für die Zusammenarbeit mit Urban Sports Club.\nRechnungsbetrag 99,80 €\nIhre Mandatsreferenz lautet 1755300.\nIhr Finance-Team von Urban Sports Club',c={documentCompanyName:'TestConsulting CC GmbH'},doc=pdf.receiptMetadata({text},c),tx={amount:-99.8,currency:'EUR',counterparty:'Urban Sports GmbH',description:'Urban Sports GmbH RNR 1755300-444135 Datum 24.09.2026'};
 assert.equal(doc.invoice,'1755300-444135');assert.equal(doc.invoiceDate,'2026-09-24');assert.deepEqual(core.match(tx,[doc]).map(d=>d.invoice),['1755300-444135']);const other=pdf.receiptMetadata({text:text.replaceAll('1755300-444135','1755300-450780')},c);assert.equal(core.match(tx,[other]).length,0);assert.equal(core.match(tx,[doc,other]).length,1);assert.deepEqual(require('../src/fibu/mail-references').mailReferences([tx]),['1755300-444135']);assert.equal(pdf.receiptMetadata({text:text.replace('Mandatsreferenz lautet 1755300','Mandatsreferenz lautet 9999999')},c).layout,undefined);
});
test('Ausdrücklich auf eine Fälligkeit begrenzte Belegbestätigung gilt nicht für spätere Beitragsjahre',()=>{
 const {applyReview}=require('../src/fibu/review'),c={documentCompanyName:'TestConsulting CC GmbH'},doc=applyReview({text:'Versicherungsbeitrag',verified:false,amounts:[]},{companyName:c.documentCompanyName,supplier:'Insurance AG',invoice:'CONTRACT123 / Fälligkeit 01.10.2026',invoiceDate:'',amount:446.03,reason:'Nur diese Fälligkeit bestätigt'},c),tx={amount:-446.03,description:'Beitrag',counterparty:'Insurance AG',date:'2026-10-01'};
 assert.equal(doc.approvedPaymentDate,'2026-10-01');assert.equal(core.match(tx,[doc]).length,1);assert.equal(core.match({...tx,date:'2027-01-01'},[doc]).length,0);assert.equal(core.match({...tx,date:'2026-09-30'},[doc]).length,0);
});

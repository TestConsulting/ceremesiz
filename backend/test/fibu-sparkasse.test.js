const test=require('node:test'),assert=require('node:assert/strict');
const pdf=require('../src/fibu/pdf');
async function fixture(){
 const {PDFDocument}=await import('../vendor/pdf-lib.mjs'),d=await PDFDocument.create(),p=d.addPage([595,842]);
 const text=(s,x,y,size=8)=>p.drawText(s,{x,y,size});
 text('Umsätze - Druckansicht',40,825,14);text('TestConsulting CC GmbH DE02120300000000202051',40,810);
 text('Anzahl Umsätze 2',40,795);text('Zeitraum 01.10.2026-31.10.2026',40,780);
 const balance=(date,amount,y)=>{text('Kontostand am',327,y);text(date+':',386,y);text(amount+' EUR',456,y);};
 balance('30.10.2026','150,00',765);text('Buchung',350,745);text('Wertstellung',400,745);
 // Footer appears first in content order, as in the real Sparkassen web print.
 balance('30.09.2026','100,00',580);text('Dieser Ausdruck ist nicht rechtsverbindlich.',40,550);
 text('Microsoft',80,700,9);text('Rechnung INV12345 | LASTSCHRIFT',80,689,7);text('30.10.2026',353,695);text('01.11.2026',403,695);text('-150',470,695,10);text(',00 EUR',490,695);
 text('Hays AG',80,640,9);text('Referenz HAYS12345 | GUTSCHRIFT',80,629,7);text('01.10.2026',353,635);text('01.10.2026',403,635);text('+200',470,635,10);text(',00 EUR',490,635);
 return pdf.extract(await d.save());
}
test('Mehrspaltige Sparkassen-PDF: Buchungsdatum, Gegenpartei, Anzahl und Saldenkontrolle',async()=>{
 const extracted=await fixture();pdf.verifyStatement(extracted,{accountHolder:'TestConsulting CC GmbH',iban:'DE02120300000000202051'},'2026-10');
 const result=pdf.transactions(extracted,'2026-10','synthetic-hash');
 assert.equal(result.transactions.length,2);assert.equal(result.controls.balanceReconciled,true);
 assert.equal(result.transactions[0].counterparty,'Microsoft');assert.equal(result.transactions[0].amount,-150);
 assert.equal(result.transactions[0].date,'2026-10-30');assert.equal(result.transactions[0].valueDate,'2026-11-01');
 assert.equal(result.transactions[1].counterparty,'Hays AG');assert.equal(result.transactions[1].amount,200);
 assert.ok(result.transactions[0].region.width>400);assert.ok(result.transactions[0].region.height>15);
 const repeat=pdf.transactions(extracted,'2026-10','synthetic-hash');assert.equal(repeat.transactions[0].id,result.transactions[0].id);
 assert.throws(()=>pdf.transactions({...extracted,text:extracted.text.replace('Anzahl Umsätze 2','Anzahl Umsätze 3')},'2026-10','hash'),/statt 3/);
 assert.throws(()=>pdf.transactions({...extracted,text:extracted.text.replace('150,00 EUR','151,00 EUR')},'2026-10','hash'),/Saldenabstimmung/);
});

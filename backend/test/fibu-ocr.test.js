const test=require('node:test'),assert=require('node:assert/strict');
const {createCanvas}=require('@napi-rs/canvas');
const {extractReceipt,receiptMetadata}=require('../src/fibu/pdf');
const {match}=require('../src/fibu/core');
test('Lokale OCR liest Bild und Scan-PDF; Vorschläge bleiben prüfpflichtig',async()=>{
 const canvas=createCanvas(1600,1000),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1600,1000);ctx.fillStyle='black';ctx.font='36px Arial';
 ['TestConsulting CC GmbH','Rechnungssteller: Beispiel GmbH','Rechnungsnummer: INV12345','Rechnungsdatum: 08.10.2026','Gesamtbetrag: 136,45 EUR'].forEach((s,i)=>ctx.fillText(s,80,120+i*100));
 const image=canvas.toBuffer('image/png'),result=await extractReceipt(image,false,{ocr:true});
 assert.match(result.text,/INV12345/);assert.match(result.text,/136,45/);assert.equal(result.ocr.requiresReview,true);assert.ok(result.ocr.confidence>70);
 const {PDFDocument}=await import('../vendor/pdf-lib.mjs');const doc=await PDFDocument.create(),embedded=await doc.embedPng(image);doc.addPage([800,500]).drawImage(embedded,{x:0,y:0,width:800,height:500});
 const scanned=await extractReceipt(Buffer.from(await doc.save()),true,{ocr:true});assert.match(scanned.text,/INV12345/);assert.equal(scanned.ocr.pages.length,1);
 const metadata=receiptMetadata(result,{documentCompanyName:'TestConsulting CC GmbH'});assert.equal(metadata.verified,true);assert.deepEqual(metadata.amounts,[136.45]);
 assert.equal(match({amount:-136.45,description:'INV12345',counterparty:''},[{...metadata,requiresReview:true}]).length,0);
 await assert.rejects(extractReceipt(Buffer.from('not an image'),false,{ocr:true}));
});

const { hash, fail, norm } = require('./core');
async function extract(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n), content = await p.getTextContent(), groups = [];
      for (const item of content.items) {
        if (!item.str) continue;
        let line = groups.find(g => Math.abs(g.y - item.transform[5]) < 3);
        if (!line) groups.push(line = { y: item.transform[5], items: [] });
        line.items.push(item);
      }
      const lines = groups.sort((a,b) => b.y-a.y).map(g => ({
        text: g.items.sort((a,b) => a.transform[4]-b.transform[4]).map(i=>i.str).join(' ').trim(),
        page: n, x: Math.min(...g.items.map(i=>i.transform[4])), y: g.y - 3,
        width: Math.max(...g.items.map(i=>i.transform[4]+i.width))-Math.min(...g.items.map(i=>i.transform[4])),
        height: Math.max(...g.items.map(i=>Math.abs(i.height)), 10) + 6,
      }));
      pages.push({ lines, items:content.items.filter(i=>i.str).map(i=>({text:i.str,x:i.transform[4],y:i.transform[5],width:i.width,height:Math.abs(i.height)})), width: p.view[2], height: p.view[3] });
    }
    return { pages, text: pages.flatMap(p=>p.lines.map(l=>l.text)).join('\n') };
  } finally { await task.destroy(); }
}
const money = s => Number(s.replace(/\./g, '').replace(',', '.').replace(/\s/g, ''));
function transactions(extracted, month, digest) {
  const sparkasse=require('./sparkasse').sparkasse(extracted,month,digest);if(sparkasse)return sparkasse;
  const result = [], issues = [];
  for (const p of extracted.pages) for (const line of p.lines) {
    if (/anfangssaldo|endsaldo|alter kontostand|neuer kontostand|saldo|übertrag/i.test(line.text)) continue;
    // Deliberately bounded format. Unsupported layouts must be reviewed, never guessed.
    const m = line.text.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(.+?)\s+([+-]?\s*(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})\s*(EUR|€)\s*$/);
    if (!m) { if (/^\d{2}\.\d{2}\./.test(line.text)) issues.push('Nicht sicher lesbare Buchungszeile: ' + line.text); continue; }
    const date = `${m[3]}-${m[2]}-${m[1]}`;
    if (date.slice(0,7) !== month || new Date(date).toISOString().slice(0,10) !== date) { issues.push('Buchungsdatum außerhalb des Prüfmonats: '+date); continue; }
    const [counterparty, ...purpose] = m[4].split(/\s*\|\s*/);
    result.push({ id: hash(`${digest}:${line.page}:${line.y}:${line.text}`), date, counterparty: purpose.length ? counterparty : '',
      description: m[4], amount: money(m[5]), currency: 'EUR', region: line, status: 'missing', receipts: [], color: null, rule: null });
  }
  if (!result.length) fail('Keine sicher auslesbaren Buchungen. Textschicht/OCR oder Banklayout muss geprüft werden.');
  return { transactions: result, issues };
}
function verifyStatement(extracted, config, month) {
  if (!extracted.text.trim()) fail('PDF ohne Textschicht: OCR/manuelle Prüfung erforderlich.');
  if (!config.accountHolder || !config.iban) fail('Kontoinhaber und IBAN müssen serverseitig konfiguriert werden.');
  if (!norm(extracted.text).includes(norm(config.accountHolder)) || !extracted.text.replace(/\s/g,'').toUpperCase().includes(config.iban.replace(/\s/g,'').toUpperCase())) fail('Kontoinhaber oder IBAN stimmen nicht mit der verifizierten Firmenkonfiguration überein.');
  const [year, mon] = month.split('-');
  // Explicit statement period required, not just transaction or filename dates.
  const period = extracted.text.match(/(?:Auszugszeitraum|Zeitraum)\s*:?\s*(\d{2})\.(\d{2})\.(\d{4})\s*(?:bis|-)\s*(\d{2})\.(\d{2})\.(\d{4})/i);
  if (!period || period[2] !== mon || period[3] !== year || period[5] !== mon || period[6] !== year) fail('Auszugszeitraum nicht eindeutig verifiziert. Banklayout manuell klären.');
}
function receiptMetadata(extracted, config) {
  const text = extracted.text;
  const companies = ['TestConsulting CC GmbH', 'AC Immo Invest GmbH', 'Ceremesiz Holding'];
  const found = companies.filter(c => norm(text).includes(norm(c)));
  const verified = found.length === 1 && norm(found[0]) === norm(config.documentCompanyName);
  const totals = [...text.matchAll(/(?:Gesamtbetrag|Bruttobetrag|Rechnungsbetrag|Total)\s*:?\s*(EUR\s*)?((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})\s*(EUR|€|USD|GBP)?/ig)]
    .filter(m=>(m[1]||/^(EUR|€)$/i.test(m[3]||''))&&!/USD|GBP/i.test(m[3]||'')).map(m=>money(m[2]));
  const microsoftInvoice=/Microsoft Ireland Operations Ltd/.test(text)&&/Rechnungsnummer\s*:/i.test(text);
  // Microsoft's German invoice separates the EUR header amount from "Summe:".
  // Accept only when the explicitly labelled sum equals a standalone EUR amount.
  if(!totals.length&&microsoftInvoice&&!/\b(?:USD|GBP|CHF|CAD|AUD)\b/.test(text)) {
    const euroLines=[...text.matchAll(/^\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})\s+EUR\s*$/gm)].map(m=>money(m[1]));
    for(const m of text.matchAll(/\bSumme\s*:\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/gi))if(euroLines.includes(money(m[1])))totals.push(money(m[1]));
  }
  const supplier = text.match(/(?:Lieferant|Rechnungssteller)\s*:\s*([^\n]+)/i)?.[1] || (microsoftInvoice?'Microsoft':'');
  const invoice = text.match(/(?:Rechnungsnummer|Rechnung\s*Nr\.?|Invoice\s*No\.?)\s*:?\s*([A-Z0-9-]+)/i)?.[1] || '';
  const date = text.match(/Rechnungsdatum\s*:?\s*(\d{2}[./]\d{2}[./]\d{4})/i)?.[1] || '';
  const amounts=[...new Set(totals)];
  return { text, verified, amounts, supplier, invoice, invoiceDate: date,
    reason: !verified ? 'Firma nicht eindeutig verifiziert' : !amounts.length ? 'Bruttobetrag nicht eindeutig auslesbar' : amounts.length>1?'Mehrere widersprüchliche Bruttobeträge':null };
}
async function annotate(original, txs) {
  const { PDFDocument, rgb, BlendMode } = await import('../../vendor/pdf-lib.mjs');
  const doc = await PDFDocument.load(original,{updateMetadata:false});
  const colors = { green: rgb(.3,.85,.42), yellow: rgb(1,.85,.15), purple: rgb(.7,.4,.85) };
  for (const t of txs) if (colors[t.color]) {
    const r = t.region, p = doc.getPage(r.page-1);
    if (r.x < 0 || r.y < 0 || r.x+r.width > p.getWidth()+1 || r.y+r.height > p.getHeight()+1) fail('PDF-Koordinaten außerhalb der Seite.');
    p.drawRectangle({ x:r.x, y:r.y, width:r.width, height:r.height, color:colors[t.color], opacity:.3, blendMode:BlendMode.Multiply });
  }
  // Always regenerate from immutable original: own marks never accumulate.
  return Buffer.from(await doc.save());
}
async function extractReceipt(bytes,isPdf=true,{ocr=false}={}) {
  const extracted=isPdf?await extract(bytes):{text:'',pages:[]};
  if(ocr&&(!isPdf||extracted.text.replace(/\s/g,'').length<40)) {
    const recognized=await require('./ocr').recognize(bytes,isPdf);
    return {...extracted,text:recognized.text,ocr:recognized};
  }
  return extracted;
}
module.exports = { extract, extractReceipt, transactions, verifyStatement, receiptMetadata, annotate };

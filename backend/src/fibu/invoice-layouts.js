const {norm}=require('./core');
function outgoing(text,company){
 if(!norm(text.split('\n')[0]||'').startsWith(norm(company.documentCompanyName||''))||!/Kunde[ \t]+Nr\.?[ \t]+\d+/i.test(text))return null;
 const invoice=text.match(/\bRechnung[ \t]+Nr\.?[ \t]+([A-Z0-9/-]+)/i)?.[1],end=text.match(/^Endbetrag[ \t]+EUR[ \t]+((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})[ \t]*$/im),customer=text.match(/\bDatum[ \t]+\d{2}\.\d{2}\.20\d{2}[ \t]*\n([^\n]+)/i)?.[1]?.trim();
 if(!invoice||!end||!customer)return null;return {invoice,amounts:[Number(end[1].replace(/\./g,'').replace(',','.'))],supplier:company.documentCompanyName,customer,direction:'outgoing',layout:'outgoing-endbetrag-eur'};
}
function extra(text){
 const result={},eur=s=>Number(s.replace(/[ \u00a0.]/g,'').replace(',','.'));
 if(/^Michael Page Contracting GmbH/m.test(text)&&/Pagetime Referenz:/i.test(text)){result.supplier='Michael Page Contracting GmbH';result.invoice=text.match(/Pagetime Referenz:[ \t]*([A-Z0-9/.-]+)/i)?.[1]||'';}
 if(/^Remittance\b/m.test(text)&&/@michaelpage\.com/i.test(text)){
  const paid=text.match(/^Total Paid[ \t]+€[ \t]*([\d ,]+,\d{2})[ \t]*$/im),reference=text.match(/^\d{2}\/\d{2}\/20\d{2}[ \t]+([0-9]+\/[0-9]+)[ \t]+Bill\b/m)?.[1];
  if(paid&&reference){Object.assign(result,{amounts:[eur(paid[1])],invoice:reference,customer:'Michael Page Contracting GmbH',direction:'outgoing',layout:'remittance-advice'});}
 }
 if(/Handels Hinze Schütz/.test(text)&&/Mandantennummer:/.test(text)){
  result.supplier='Handels Hinze Schütz Partnerschaft mbB';const value=text.match(/Rechnungsbetrag von[ \t]+([\d.]+,\d{2})[ \t]+EUR/i);if(value)result.amounts=[eur(value[1])];
  const inv=text.match(/Rechnungsnummer:[ \t]*(20\d{2})\/(\d{4,})/i),date=text.match(/Rechnungsdatum:[ \t]*(\d{2})\.(\d{2})\.(20\d{2})/i),mandate=text.match(/zum Mandat[ \t]+([0-9]{8,})/i)?.[1];
  if(inv&&date&&mandate&&inv[1]===date[3])result.referenceEvidence={reference:inv[2]+'/'+date[1]+'.'+date[2]+'.'+date[3].slice(-2),mandate};
 }
 if(/^Comfort M\.B\.C\. GmbH/m.test(text)){
  result.supplier='Comfort M.B.C. GmbH';const period=text.match(/Leistungszeitraum[ \t]+(\d{2})\.(\d{2})\.(20\d{2})[ \t]*-[ \t]*(\d{2})\.(\d{2})\.(20\d{2})/i);
  if(period&&/Vereinbarungsgemäß berechnen/i.test(text))result.recurringPeriod={from:period[3]+'-'+period[2]+'-'+period[1],to:period[6]+'-'+period[5]+'-'+period[4]};
 }
 if(/B2Mobility GmbH/.test(text)&&/R\s+E\s+C\s+H\s+N\s+U\s+N\s+G/.test(text)&&!/KEINE RECHNUNG/i.test(text)){
  const numbers=[...new Set([...text.matchAll(/^\d+[ \t]+(0\d{9})[ \t]+Blatt:/gm)].map(m=>m[1]))];
  const totals=[...text.matchAll(/([\d.]+,\d{2})[ \t]+\1[ \t]+([\d.]+,\d{2})[ \t]+\2[ \t]*\nBetrag Brutto EUR/g)].map(m=>eur(m[2]));
  if(numbers.length===1&&totals.length===1)Object.assign(result,{supplier:'B2Mobility GmbH FuelsCard',invoice:numbers[0],amounts:totals,layout:'fuelscard-confirmed-gross-columns'});
 }
 const card=text.match(/Datum:[ \t]*(\d{2})\.(\d{2})\.(20\d{2})[ \t]*\|[ \t]*Uhrzeit:[ \t]*(\d{2}:\d{2}):\d{2}/);
 if(card&&/Genehmigt/.test(text)){
  const sums=[...new Set([...text.matchAll(/\bSumme:[ \t]*€[ \t]*([\d.]+,\d{2})/g)].map(m=>eur(m[1])))];
  if(sums.length===1){result.amounts=sums;result.cardEvidence={timestamp:card[3]+'-'+card[2]+'-'+card[1]+'T'+card[4]};const unique=re=>{const v=[...new Set([...text.matchAll(re)].map(m=>m[1]))];return v.length===1?v[0]:null;};Object.assign(result.cardEvidence,{reference:unique(/\bReferenz:[ \t]*([0-9]{6,}-[0-9]{6,})/g),tender:unique(/\bTender:[ \t]*([A-Za-z0-9]{8,})/g),merchantId:unique(/\bMID:[ \t]*([0-9]{8,})/g),issuerVat:unique(/Ust\.-Ident\.-Nr\.:[ \t]*(DE[0-9]{9})/gi)});}
 }
 return result;
}
module.exports={outgoing,extra};

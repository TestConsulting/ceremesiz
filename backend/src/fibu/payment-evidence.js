const {norm}=require('./core');
const number='(?:\\d{1,3}(?:[., \\u00a0]\\d{3})*|\\d+)[.,]\\d{2}';
function amount(value){const s=value.replace(/[ \u00a0]/g,'');if(!/^[\d.,]+[.,]\d{2}$/.test(s))return null;const n=Number(s.slice(0,-3).replace(/[.,]/g,'')+'.'+s.slice(-2));return n>0&&n<1e9?n:null;}
const single=values=>{const list=[...new Set(values.filter(v=>v!==null&&v!==undefined&&v!==''))];return list.length===1?list[0]:null;};
const collect=(text,re,fn)=>[...text.matchAll(re)].map(fn);
function brand(value){return norm(value.replace(/\b(?:pty\.?\s*ltd\.?|(?:us[,]?\s*)?inc\.?|limited|ltd\.?|gmbh|llc)\b[,.]?/gi,'').trim());}
function isoDate(year,month,day){const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;return !Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date?date:null;}
function invoiceEvidence(text){
 const reference=single(collect(text,/\bInvoice\s+(?:number|no\.?)\s*:[ \t]*([A-Z0-9][A-Z0-9/.-]{4,99})/gi,m=>m[1].toUpperCase()));
 const total=single(collect(text,new RegExp('^Invoice Total:[ \\t]*(USD|EUR|GBP|CHF)[ \\t]+('+number+')[ \\t]*$','gim'),m=>JSON.stringify({currency:m[1].toUpperCase(),amount:amount(m[2])})));
 const paid=single(collect(text,new RegExp('^Amount paid via PayPal:[ \\t]*(USD|EUR|GBP|CHF)[ \\t]+('+number+')[ \\t]*$','gim'),m=>JSON.stringify({currency:m[1].toUpperCase(),amount:amount(m[2])})));
 const supplier=text.match(/^Invoice\s*\n([^\n]+)$/im)?.[1]?.trim().replace(/,$/,'');
 const dateMatch=text.match(/Invoice date:[ \t]*([A-Za-z]{3})[ \t]+(\d{1,2}),[ \t]+(20\d{2})/i),months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 const date=dateMatch?isoDate(dateMatch[3],months.indexOf(dateMatch[1].toLowerCase())+1,dateMatch[2]):null;
 if(!reference||!total||total!==paid||!supplier||brand(supplier).length<5||!date)return null;
 const parsed=JSON.parse(total);if(!parsed.amount)return null;
 return {type:'invoice',reference,supplier,merchant:brand(supplier),date,...parsed};
}
function paymentEvidence(text){
 // Ignore generated summaries about a bank match; use the actual reproduced payment message only.
 const body=text.includes('Inhalt der Zahlungsmitteilung')?text.split('Inhalt der Zahlungsmitteilung').slice(1).join('Inhalt der Zahlungsmitteilung'):text;
 if(!/Sie haben eine Zahlung gesendet/i.test(body)||/^(?:Status[ \t:]+)?(?:Zahlung (?:storniert|zurückgebucht|ausstehend)|Autorisierung)[ \t.!]*$/im.test(body))return null;
 const reference=single(collect(body,/\bBestellnummer[ \t:]+([A-Z0-9][A-Z0-9/.-]{4,99})/gi,m=>m[1].toUpperCase()));
 const merchantName=single(collect(body,/^Händler[ \t:]+([^\n]+)$/gim,m=>m[1].trim()));
 const paid=single(collect(body,new RegExp('^Gesamtbetrag[ \\t:]+('+number+')[ \\t]*[$€£]?[ \\t]+(USD|EUR|GBP|CHF)[ \\t]*$','gim'),m=>JSON.stringify({amount:amount(m[1]),currency:m[2].toUpperCase()})));
 const debit=single(collect(body,new RegExp('^.*Girokonto[^\\d\\n]*([0-9]{4})[ \\t]+('+number+')[ \\t]*(?:€(?:[ \\t]+EUR)?|EUR)[ \\t]*$','gim'),m=>JSON.stringify({accountSuffix:m[1],amount:amount(m[2])})));
 const transaction=single(collect(body,/Transaktionscode:[ \t]*([A-Z0-9]{10,40})\b/gi,m=>m[1].toUpperCase()));
 const dm=body.match(/Transaktionsdatum[ \t:]+(\d{2})\.(\d{2})\.(20\d{2})/i),date=dm?isoDate(dm[3],dm[2],dm[1]):null;
 if(!reference||!merchantName||!paid||!debit||!transaction||!date)return null;
 const source=JSON.parse(paid),funding=JSON.parse(debit);if(!source.amount||!funding.amount)return null;
 return {type:'payment_notice',reference,merchant:brand(merchantName),supplier:merchantName,date,transaction,sourceAmount:source.amount,sourceCurrency:source.currency,eurAmount:funding.amount,accountSuffix:funding.accountSuffix};
}
function metadata(text){return paymentEvidence(text)||invoiceEvidence(text);}
function qualifiedPayments(transactions,documents,company){
 const groups=[],suffix=String(company.iban||'').replace(/\s/g,'').slice(-4);if(!/^\d{4}$/.test(suffix))return groups;
 for(const invoice of documents.filter(d=>d.verified&&!d.requiresReview&&d.evidence?.type==='invoice'))for(const payment of documents.filter(d=>!d.requiresReview&&d.evidence?.type==='payment_notice')){
  const i=invoice.evidence,p=payment.evidence;
  if(i.reference!==p.reference||i.merchant!==p.merchant||i.currency!==p.sourceCurrency||Math.abs(i.amount-p.sourceAmount)>.004||p.accountSuffix!==suffix)continue;
  const invoiceDelay=(Date.parse(p.date)-Date.parse(i.date))/86400000;if(invoiceDelay<0||invoiceDelay>7)continue;
  for(const t of transactions){
   const days=(Date.parse(t.date)-Date.parse(p.date))/86400000;
   if(t.amount>=0||t.currency!=='EUR'||Math.abs(Math.abs(t.amount)-p.eurAmount)>.004||days<0||days>7||!/^paypal\b/i.test(t.counterparty||''))continue;
   const merchantWords=p.supplier.replace(/\b(?:pty\.?\s*ltd\.?|(?:us[,]?\s*)?inc\.?|limited|ltd\.?|gmbh|llc)\b[,.]?/gi,'').replace(/[,.\s]+$/,'').trim();
   if(brand(merchantWords).length<5||!new RegExp('(?:^|[^a-z0-9])'+merchantWords.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])','i').test(t.description))continue;
   groups.push({transaction:t,documents:[invoice,payment],invoice,payment,evidence:{type:'invoice_payment_chain',reference:i.reference,sourceAmount:i.amount,sourceCurrency:i.currency,eurAmount:p.eurAmount,paymentTransaction:p.transaction,accountSuffix:suffix,paymentDate:p.date}});
  }
 }
 // A payment, invoice or bank row may not silently satisfy several competing chains.
 return groups.filter(g=>!groups.some(other=>other!==g&&(other.transaction.id===g.transaction.id||other.documents.some(d=>g.documents.some(x=>x.id===d.id))||other.evidence.paymentTransaction===g.evidence.paymentTransaction)));
}
module.exports={metadata,qualifiedPayments,amount,brand};

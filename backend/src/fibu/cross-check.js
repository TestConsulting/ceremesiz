const {norm}=require('./core');
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function moneyHits(text,value){const german=value.toFixed(2).replace('.',','),english=value.toFixed(2);return (text.replace(/[ \u00a0]/g,'').match(new RegExp('(?:^|[^0-9])(?:'+esc(german)+'|'+esc(english)+')(?=$|[^0-9])','g'))||[]).length;}
function qualifiedCrossChecks(transactions,documents,company){
 const groups=require('./reimbursements').reimbursements(transactions,documents);
 for(const d of documents.filter(d=>d.requiresReview&&d.ocr?.confidence>=50)){
  const compact=norm(d.text),digits=d.text.replace(/\s+/g,''),suffix=String(company.iban||'').replace(/\s/g,'').slice(-4);
  for(const t of transactions){
   if(t.amount>=0||t.currency!=='EUR'||!moneyHits(d.text,Math.abs(t.amount)))continue;
   const references=[...new Set(t.description.match(/(?<!\d)\d{8,}(?!\d)/g)||[])].filter(ref=>digits.includes(ref));
   const partyWords=(t.counterparty||'').match(/[A-Za-zÄÖÜäöüß]{5,}/g)||[];
   const merchant=partyWords.some(word=>!['germany','gmbh','gesellschaft'].includes(word.toLowerCase())&&compact.includes(norm(word)));
   const ownsAccount=/\d{4}/.test(suffix)&&digits.includes(suffix)&&/IBAN|Girokonto/i.test(d.text);
   const cardTime=t.description.match(/\b(\d{2})\.(\d{2})[ \t]+(\d{2})[.:](\d{2})\b/),terminal=d.text.match(/Terminal-ID[ \t:]+(\d{8})/i)?.[1];
   const stamp=cardTime?t.date.slice(2,4)+cardTime[2]+cardTime[1]+cardTime[3]+cardTime[4]:null;
   const cardVerified=!!(stamp&&terminal&&references.includes(terminal)&&/SEPA-ELV-LASTSCHRIFT/.test(t.description)&&new RegExp('(?:^|[^0-9])'+terminal+'[0-9]*'+stamp+'(?:$|[^0-9])').test(d.text.replace(/[ \t]/g,''))&&moneyHits(d.text,Math.abs(t.amount))>=2);
   if(!merchant||!references.length||(!d.verified&&!(ownsAccount&&references.length>=2)&&!cardVerified))continue;
   if(d.verified&&references.length===1&&moneyHits(d.text,Math.abs(t.amount))<2)continue;
   groups.push({transactions:[t],documents:[d],reason:'OCR-Beleg unabhängig gegengeprüft: Bankreferenz, EUR-Betrag, Händler und Firmen-/Kontozuordnung stimmen.',evidence:{type:'ocr_bank_crosscheck',references,documentHash:d.hash,amount:Math.abs(t.amount),companyVerified:d.verified,accountVerified:ownsAccount,cardVerified}});
  }
 }
 return groups.filter(g=>!groups.some(other=>other!==g&&(other.transactions.some(t=>g.transactions.some(x=>x.id===t.id))||other.documents.some(d=>g.documents.some(x=>x.id===d.id)))));
}
module.exports={qualifiedCrossChecks,moneyHits};

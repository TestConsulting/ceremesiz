const {norm}=require('./core');
const amount=s=>Math.abs(Number(s.replace(/\./g,'').replace(',','.')));
function reimbursements(transactions,documents){
 const groups=[];
 for(const d of documents){
  if(!d.verified||!d.requiresReview||!(d.ocr?.confidence>=70)||!d.ocr?.header||!(d.ocr.header.confidence>=70)||!/Aufwendungsausgleichsgesetz.*AAG/i.test(d.text)||!/BARMER/.test(d.text)||!/auf Ihr Konto überwiesen/i.test(d.text))continue;
  const dates=[...new Set(d.ocr.header.text.match(/\b\d{2}\.\d{2}\.20\d{2}\b/g)||[])];if(dates.length!==1)continue;
  const [day,month,year]=dates[0].split('.'),date=year+'-'+month+'-'+day;if(Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!norm(d.text).includes('dv'+month+year.slice(-2)))continue;
  const table=d.text.split(/Erstattungsbetrag[^\n]*\n/i)[1]?.split(/Summe:/i)[0],sum=d.text.match(/Summe:[ \t]*-?([\d.]+,\d{2})/i)?.[1];if(!table||!sum)continue;
  const amounts=[...table.matchAll(/(-?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})[ \t]*$/gm)].map(m=>amount(m[1]));if(amounts.length<2||amounts.length>20||new Set(amounts).size!==amounts.length||Math.abs(amounts.reduce((a,v)=>a+v,0)-amount(sum))>.005)continue;
  const rows=amounts.map(value=>transactions.filter(t=>t.amount>0&&t.currency==='EUR'&&Math.abs(t.amount-value)<.005&&/^barmer\b/i.test(t.counterparty||'')&&/ERSTATTUNG NACH AAG/i.test(t.description)&&(Date.parse(t.date)-Date.parse(date))/86400000>=0&&(Date.parse(t.date)-Date.parse(date))/86400000<=7));
  if(rows.some(r=>r.length!==1)||new Set(rows.map(r=>r[0].date)).size!==1)continue;
  groups.push({transactions:rows.map(r=>r[0]),documents:[d],reason:'AAG-Erstattung: Firma, Kasse, hochaufgelöstes Bescheiddatum mit Postmonat, Einzelbeträge und Gesamtsumme stimmen mit den Gutschriften überein.',evidence:{type:'aag_reimbursement_group',documentHash:d.hash,date,amounts,total:amount(sum)}});
 }
 return groups;
}
module.exports={reimbursements};

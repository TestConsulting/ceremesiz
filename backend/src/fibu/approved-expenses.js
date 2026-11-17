function confirmedFuelReimbursements(transactions,documents){
 const groups=[];
 for(const d of documents){
  if(!d.verified||d.requiresReview||!d.manualVerification||d.amounts?.length!==1||!/^20\d{2}-\d{2}-\d{2}$/.test(d.invoiceDate||'')||!d.invoice||!/diesel|benzin|kraftstoff|\bsuper\b/i.test(d.text||'')||!/tankstelle|\baral\b|\bshell\b|\besso\b/i.test(d.text||''))continue;
  for(const t of transactions){
   const lag=(Date.parse(t.date)-Date.parse(d.invoiceDate))/86400000;
   if(t.currency!=='EUR'||t.amount>=0||!Number.isFinite(lag)||lag<0||lag>7||! /Erstattung[ \t]+Tank(?:beleg|kosten)/i.test(t.description)||Math.abs(Math.abs(t.amount)-d.amounts[0])>.005)continue;
   groups.push({transactions:[t],documents:[d],reason:'Am Original bestätigter Tankbeleg: Nutzerfreigabe zur Firmenzuordnung, Erstattungszweck, EUR-Betrag und Zeitraum stimmen eindeutig.',evidence:{type:'confirmed_expense_reimbursement',documentHash:d.hash,receiptReference:d.invoice,receiptDate:d.invoiceDate,amount:d.amounts[0],reviewed:true}});
  }
 }
 return groups.filter(g=>!groups.some(other=>other!==g&&(other.transactions[0].id===g.transactions[0].id||other.documents[0].id===g.documents[0].id)));
}
module.exports={confirmedFuelReimbursements};

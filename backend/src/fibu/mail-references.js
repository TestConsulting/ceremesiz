function mailReferences(transactions){
 const result=new Set();
 const add=ref=>{if(typeof ref==='string'&&/^[A-Z0-9][A-Z0-9/.-]{4,79}$/i.test(ref)&&/\d/.test(ref))result.add(ref.replace(/[.-]+$/,''));};
 for(const t of transactions){
  const text=t.description||'',party=t.counterparty||'';
  const labelled=/\b(?:Rechnungs?[- \t]*(?:nummer|Nr\.?)|Rechnung|Invoice(?:[ \t]+(?:number|no\.?))?|RG[- \t]*Nr\.?|RNR)[ \t.:#-]*([A-Z0-9][A-Z0-9/.-]{4,59})/gi;
  for(const m of text.matchAll(labelled))add(m[1]);
  if(/^hays(?:\s+ag)?$/i.test(party))for(const ref of text.match(/[A-Z0-9-]{5,80}/gi)||[])add(ref);
  if(/^Microsoft Payments$/i.test(party))for(const m of text.matchAll(/\b(?:Microsoft\s*\.|MSFT\s*\.?\s*)\s*([A-Z][A-Z0-9]{8,19})\b/gi))add(m[1]);
  if(/^AMAZON PAYMENTS EUROPE\b/i.test(party))for(const m of text.matchAll(/\b(\d{3}-\d{7}-\d{7})\b/g))add(m[1]);
  if(/^STRATO GmbH$/i.test(party))for(const m of text.matchAll(/\bDRP[ \t]*(\d{8,12})\b/gi))add('DRP'+m[1]);
  if(/Telefonica Germany/i.test(party))for(const m of text.matchAll(/\bRg-Nr\.:?[ \t]*(\d{8,12})\/[0-9]{1,2}\b/gi))add(m[1]);
  if(/Handels.*Hinze/i.test(party))for(const m of text.matchAll(/\bReNr:[ \t]*(\d{4,8})\/\d{2}\.\d{2}\.(\d{2})\b/gi))if(t.date?.slice(2,4)===m[2])add('20'+m[2]+'/'+m[1]);
 }
 return [...result].slice(0,40);
}
module.exports={mailReferences};

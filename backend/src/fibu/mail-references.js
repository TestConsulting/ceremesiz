function mailReferences(transactions){
 const result=new Set();
 for(const t of transactions){
  const text=t.description||'';
  const labelled=/\b(?:Rechnungs?[- \t]*(?:nummer|Nr\.?)|Rechnung|Invoice(?:[ \t]+(?:number|no\.?))?|RG[- \t]*Nr\.?)[ \t.:#-]*([A-Z0-9][A-Z0-9/.-]{4,59})/gi;
  for(const m of text.matchAll(labelled))if(/\d/.test(m[1]))result.add(m[1].replace(/[.-]+$/,''));
  if(/^hays(?:\s+ag)?$/i.test(t.counterparty||''))for(const ref of text.match(/[A-Z0-9-]{5,80}/gi)||[])if(/\d/.test(ref))result.add(ref);
 }
 return [...result].slice(0,40);
}
module.exports={mailReferences};

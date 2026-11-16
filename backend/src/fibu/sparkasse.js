const {hash,fail}=require('./core');
const toCents=s=>Math.round(Number(s.replace(/\s|EUR|€/g,'').replace(/\./g,'').replace(',','.'))*100);
const iso=s=>{const [d,m,y]=s.split('.');const date=`${y}-${m}-${d}`;if(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('Ungültiges Datum in Sparkassen-Tabelle.');return date;};
function sparkasse(extracted,month,digest){
 if(!/Umsätze\s*-\s*Druckansicht/.test(extracted.text))return null;
 const first=extracted.pages[0],booking=first.items?.find(i=>i.text==='Buchung'),value=first.items?.find(i=>i.text==='Wertstellung');
 if(!booking||!value||booking.x>=value.x)fail('Sparkassen-Spalten nicht eindeutig erkannt.');
 const expected=Number(extracted.text.match(/Anzahl Umsätze\s+(\d+)/)?.[1]);
 if(!expected||expected>10000)fail('Anzahl Umsätze fehlt oder ist ungültig.');
 const result=[];
 for(let pageIndex=0;pageIndex<extracted.pages.length;pageIndex++){
  const page=extracted.pages[pageIndex];if(!page.items||Math.abs(page.width-first.width)>1)fail('Abweichende Sparkassen-Seitengeometrie.');
  const isBooking=i=>/^\d{2}\.\d{2}\.\d{4}$/.test(i.text)&&Math.abs(i.x-booking.x)<8;
  const anchors=page.items.filter(isBooking);if(!anchors.length)continue;
  const minimum=Math.min(...anchors.map(i=>i.y));
  // Print headers and balances are outside the body. A closing balance may precede
  // transactions in PDF content order, so use coordinates rather than stream order.
  const bottomBalance=page.items.find(i=>/^Kontostand am$/.test(i.text)&&i.y<minimum-10);
  const top=pageIndex===0?booking.y-2:page.height-35,bottom=bottomBalance?bottomBalance.y+10:35;
  const items=page.items.filter(i=>i.text.trim()&&i.y<top&&i.y>bottom);
  let left=[];
  for(const item of items){
   if(item.x<booking.x-10){left.push(item);continue;}
   if(!isBooking(item))continue;
   const valueDates=items.filter(i=>Math.abs(i.x-value.x)<8&&Math.abs(i.y-item.y)<2&&/^\d{2}\.\d{2}\.\d{4}$/.test(i.text));
   const amountParts=items.filter(i=>i.x>value.x+45&&Math.abs(i.y-item.y)<2).sort((a,b)=>a.x-b.x);
   const amountText=amountParts.map(i=>i.text).join('').replace(/\s/g,'').replace(/−/g,'-');
   if(valueDates.length!==1||! /^[+-](?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}EUR$/.test(amountText)||!left.length)fail('Sparkassen-Buchungszeile nicht eindeutig.');
   const date=iso(item.text);if(date.slice(0,7)!==month)fail('Sparkassen-Buchung außerhalb des Auftragsmonats.');
   const merchantHeight=Math.max(...left.map(i=>i.height));
   const merchant=left.filter(i=>Math.abs(i.height-merchantHeight)<.2);
   const description=left.map(i=>i.text).join(' ').replace(/\s+/g,' ').trim();
   const counterparty=merchant.map(i=>i.text).join(' ').replace(/\s+/g,' ').trim();
   if(!counterparty||merchantHeight<7)fail('Gegenpartei in Sparkassen-Zeile nicht eindeutig.');
   const regionItems=[...left,item,...valueDates,...amountParts],x=Math.min(...regionItems.map(i=>i.x))-2,y=Math.min(...regionItems.map(i=>i.y))-3;
   const region={page:pageIndex+1,x,y,width:Math.max(...regionItems.map(i=>i.x+i.width))-x+2,height:Math.max(...regionItems.map(i=>i.y+i.height))-y+1};
   const cents=toCents(amountText);
   result.push({id:hash(`${digest}:${pageIndex+1}:${item.y}:${description}:${cents}`),date,valueDate:iso(valueDates[0].text),counterparty,description,amount:cents/100,currency:'EUR',region,status:'missing',receipts:[],color:null,rule:null});
   left=[];
  }
  if(left.length)fail('Nicht zugeordneter Text am Ende der Sparkassen-Tabelle.');
 }
 if(result.length!==expected)fail(`Sparkassen-Kontrolle: ${result.length} statt ${expected} Buchungen erkannt.`);
 const balances=[...extracted.text.matchAll(/Kontostand am\s+(\d{2}\.\d{2}\.\d{4}):\s+([+-]?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})\s+EUR/g)].map(m=>({date:iso(m[1]),cents:toCents(m[2])}));
 const startDay=new Date(month+'-01T00:00:00Z');startDay.setUTCDate(0);const startDate=startDay.toISOString().slice(0,10);
 const opening=balances.filter(b=>b.date===startDate),closing=balances.filter(b=>b.date.slice(0,7)===month&&b.date>=result.map(t=>t.date).sort().at(-1));
 if(opening.length!==1||closing.length!==1)fail('Sparkassen-Salden nicht eindeutig dem Prüfmonat zugeordnet.');
 const sum=result.reduce((s,t)=>s+Math.round(t.amount*100),0);
 if(opening[0].cents+sum!==closing[0].cents)fail('Sparkassen-Saldenabstimmung fehlgeschlagen. Keine automatische Verarbeitung.');
 return {transactions:result,issues:[],controls:{format:'sparkasse-web-print',expectedCount:expected,parsedCount:result.length,openingBalanceDate:opening[0].date,closingBalanceDate:closing[0].date,balanceReconciled:true}};
}
module.exports={sparkasse};

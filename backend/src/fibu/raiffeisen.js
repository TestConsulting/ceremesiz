const {hash,fail}=require('./core');
const cents=s=>Math.round(Number(s.replace(/\./g,'').replace(',','.'))*100);
function raiffeisen(x,month,digest){
 if(!/Raiffeisen-Bank/.test(x.text)||!/Filterparameter/.test(x.text)||!/Startsaldo/.test(x.text))return null;
 const opening=x.text.match(/\(Startsaldo\)\s+([+-][\d.,]+) EUR/),closing=x.text.match(/\(Endsaldo\)\s+([+-][\d.,]+) EUR/);if(!opening||!closing)fail('Raiffeisen-Salden fehlen.');
 const transactions=[];for(let pageIndex=0;pageIndex<x.pages.length;pageIndex++){
 const page=x.pages[pageIndex],lines=page.lines;for(let i=0;i<lines.length;i++){
 const line=lines[i],m=line.text.match(/^(.+?)\s+([+-](?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}) EUR$/);if(!m||/saldo\)/i.test(line.text))continue;
 const block=[line];let j=i+1;for(;j<lines.length;j++){if(/[+-][\d.,]+ EUR$/.test(lines[j].text)||/^Seite \d|Wir machen den Weg/.test(lines[j].text))break;block.push(lines[j]);}
 const dates=block.slice(1).map(l=>l.text.match(/(\d{2})\.(\d{2})\.(\d{4})$/)).filter(Boolean);if(!dates.length)fail('Raiffeisen-Buchungsdatum fehlt.');const d=dates[0],date=d[3]+'-'+d[2]+'-'+d[1];if(date.slice(0,7)!==month||new Date(date).toISOString().slice(0,10)!==date)fail('Raiffeisen-Buchung außerhalb des Monats.');
 const left=Math.min(...block.map(l=>l.x)),bottom=Math.min(...block.map(l=>l.y));const region={page:pageIndex+1,x:left,y:bottom,width:Math.max(...block.map(l=>l.x+l.width))-left,height:Math.max(...block.map(l=>l.y+l.height))-bottom};
 const description=block.map(l=>l.text).join(' ');transactions.push({id:hash(digest+':'+pageIndex+':'+line.y+':'+description),date,counterparty:m[1],description,amount:cents(m[2])/100,currency:'EUR',region,status:'missing',receipts:[],color:null,rule:null});i=j-1;
 }}
 if(!transactions.length||cents(opening[1])+transactions.reduce((s,t)=>s+Math.round(t.amount*100),0)!==cents(closing[1]))fail('Raiffeisen-Saldenabstimmung fehlgeschlagen.');
 return {transactions,issues:[],controls:{format:'raiffeisen-web-print',parsedCount:transactions.length,balanceReconciled:true}};
}
module.exports={raiffeisen};

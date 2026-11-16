const names={strato:'STRATO',fuelscard:'B2Mobility / FuelsCard',microsoft:'Microsoft',amazon:'Amazon',huk:'HUK-COBURG',sachbezug:'Sachbezugskarte'};
const defaults={microsoft:'https://admin.cloud.microsoft/?#/billoverview/invoice-list',sachbezug:'https://www.sachbezugskarte.eu/#/secure/report/billing'};
const {fail,hash}=require('./core');
function sources(c){return Object.entries(names).map(([id,name])=>{
 let url=c.portalUrls?.[id]||defaults[id]||null;
 if(url){try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error();url=u.href;}catch{url=null;}}
 return {id,name,url,mode:'manual_download',automatic:false,status:url?'Manueller Download und Import':'Portaladresse / Anmeldung fehlt'};
});}
function validateImport(b){
 if(!names[b.source]||typeof b.name!=='string'||! /\.(pdf|png|jpe?g)$/i.test(b.name)||b.name.length>240||/[\\/\0]/.test(b.name))fail('Quelle und PDF-/Bilddatei angeben.',400);
 if(typeof b.data!=='string'||!b.data.length||b.data.length>35*1024*1024||b.data.length%4!==0)fail('Dateiübertragung ungültig.',400);
 const bytes=Buffer.from(b.data,'base64');if(bytes.length>25*1024*1024)fail('Datei über 25 MB.',413);if(bytes.toString('base64')!==b.data)fail('Dateiübertragung ungültig.',400);
 const pdf=/\.pdf$/i.test(b.name),png=/\.png$/i.test(b.name),sig=pdf?bytes.subarray(0,5).toString()==='%PDF-':png?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!sig)fail('Dateiinhalt passt nicht zur Endung.',400);
 return {bytes,hash:hash(bytes),source:b.source,name:b.name};
}
module.exports={sources,validateImport,names};

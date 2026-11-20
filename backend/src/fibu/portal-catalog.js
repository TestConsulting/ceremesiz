const {fail}=require('./core');
const catalog={
 lebara:{name:'Lebara',url:'https://www.lebara.de/de/mylebara.html',domains:['lebara.de']},
 urban_sports_club:{name:'Urban Sports Club',url:'https://portal.urbansportsclub.com/login',domains:['urbansportsclub.com']},
 strato:{name:'STRATO',url:'https://www.strato.de/apps/CustomerService',domains:['strato.de']},
 fuelscard:{name:'B2Mobility / FuelsCard',url:'https://www.fuelscard.de/',domains:['fuelscard.de']},
 microsoft:{name:'Microsoft',url:'https://admin.cloud.microsoft/',domains:['microsoft.com','microsoftonline.com','live.com','msauth.net','msftauth.net']},
 amazon:{name:'Amazon',url:'https://www.amazon.de/',domains:['amazon.de']},
 huk:{name:'HUK-COBURG',url:'https://www.huk.de/meine-huk/',domains:['huk.de']},
 sachbezug:{name:'Sachbezugskarte',url:'https://www.sachbezugskarte.eu/',domains:['sachbezugskarte.eu']}
};
function allowedUrl(provider,value){const p=catalog[provider];try{const u=new URL(value);if(!p||u.protocol!=='https:'||u.username||u.password||u.port||!p.domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw Error();return u.href;}catch{fail('Nur freigegebene HTTPS-Adressen dieses Lieferanten verwenden.',400);}}
function validateAccount(provider,b,old){
 if(!catalog[provider])fail('Lieferant unbekannt.',404);
 if(typeof b.username!=='string'||!b.username.trim()||b.username.length>320||typeof b.enabled!=='boolean'||typeof b.automatic!=='boolean'||!Number.isInteger(b.version))fail('Benutzername, Aktivierung und Version angeben.',400);
 const password=b.password||old?.password;if(typeof password!=='string'||!password||password.length>4096)fail('Passwort fehlt.',400);
 const selectors={};for(const key of ['username','password','submit','invoiceNavigation','invoiceRows','download','otp','otpSubmit']){const value=b.selectors?.[key]||'';if(typeof value!=='string'||value.length>500)fail('Ungültiger Auswahlpfad.',400);selectors[key]=value.trim();}
 return {username:b.username.trim(),password,enabled:b.enabled,automatic:b.automatic,loginUrl:allowedUrl(provider,b.loginUrl||catalog[provider].url),invoiceUrl:b.invoiceUrl?allowedUrl(provider,b.invoiceUrl):'',selectors,session:old&&old.username===b.username.trim()&&old.password===password&&old.loginUrl===(b.loginUrl||catalog[provider].url)?old.session:null,updatedAt:new Date().toISOString()};
}
function publicAccount(provider,value,status){const p=catalog[provider];return {id:provider,name:p.name,url:p.url,configured:!!value,username:value?.username||'',hasPassword:!!value?.password,enabled:value?.enabled||false,automatic:value?.automatic||false,loginUrl:value?.loginUrl||p.url,invoiceUrl:value?.invoiceUrl||'',selectors:value?.selectors||{},version:value?.version||0,hasSession:!!value?.session,status:status||{state:value?'ready':'not_configured',message:value?'Zugang gespeichert · Abruf noch nicht geprüft':'Noch kein Zugang hinterlegt'}};}
module.exports={catalog,allowedUrl,validateAccount,publicAccount};

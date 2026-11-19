const fs=require('node:fs');
const {fail}=require('./core');
const names={tc:'TestConsulting CC GmbH',immo:'AC Immo Invest GmbH',holding:'Ceremesiz Holding'};
function loadConfig() {
  if(!process.env.FIBU_CONFIG_PATH) return {companies:{},mode:'disabled'};
  const c=JSON.parse(fs.readFileSync(process.env.FIBU_CONFIG_PATH,'utf8'));
  if(!['local','remote','cloud'].includes(c.mode)) fail('Lokalen, gekoppelten oder serverseitigen Ausführungsmodus konfigurieren.',503);
  for(const [id,v] of Object.entries(c.companies||{})) {
    if(c.mode==='cloud'&&v.enabled&&(id==='tc'||v.pilotAccepted===true))require('./onedrive').cleanPath(v.cloud?.rootPath);
    if(v.microsoftConnectionCompany!==undefined&&(!names[v.microsoftConnectionCompany]||!c.companies[v.microsoftConnectionCompany]||v.microsoftConnectionCompany===id||c.companies[v.microsoftConnectionCompany].microsoftConnectionCompany))fail('Ungültige gemeinsame Microsoft-Verbindung: '+id,503);
    if(v.mailEnabled!==undefined&&typeof v.mailEnabled!=='boolean')fail('Ungültige E-Mail-Freischaltung: '+id,503);
    if(v.bankAccounts!==undefined&&(!Array.isArray(v.bankAccounts)||v.bankAccounts.length<1||v.bankAccounts.length>5||new Set(v.bankAccounts.map(a=>a.id)).size!==v.bankAccounts.length||new Set(v.bankAccounts.map(a=>a.iban?.replace(/\s/g,''))).size!==v.bankAccounts.length||v.bankAccounts.some(a=>!a.id||!a.label||!a.accountHolder||!/^DE\d{20}$/.test(a.iban?.replace(/\s/g,'')||''))))fail('Firmenkonten unvollständig oder doppelt: '+id,503);
    if(v.ocrEnabled!==undefined&&typeof v.ocrEnabled!=='boolean')fail('OCR-Freischaltung muss true oder false sein: '+id,503);
    if(v.pilotMode!==undefined&&typeof v.pilotMode!=='boolean')fail('Pilotmodus muss true oder false sein: '+id,503);
    if(!names[id] || !v.root || !v.collectionFolder || !v.accountHolder || !v.iban || !v.documentCompanyName) fail('Unvollständige Firmenkonfiguration: '+id,503);
    if(typeof v.enabled!=='boolean'||(v.allowedUsers!==undefined&&(!Array.isArray(v.allowedUsers)||v.allowedUsers.some(e=>typeof e!=='string'||!e.includes('@'))))||(v.greenCounterparties!==undefined&&(!Array.isArray(v.greenCounterparties)||v.greenCounterparties.some(s=>typeof s!=='string'||!s.trim()))))fail('Ungültige Freischaltung/Benutzer-/Gegenparteienkonfiguration: '+id,503);
    if(id!=='tc' && v.pilotAccepted!==true) v.enabled=false;
  }
  return c;
}
function companyFor(config,user,id,{allowDisabled=false}={}) {
  const c=config.companies?.[id];
  if(!c || (!allowDisabled&&!c.enabled)) fail('FiBu-Verbindung für diese Firma ist noch nicht eingerichtet.',403);
  return c;
}
module.exports={loadConfig,companyFor,names};

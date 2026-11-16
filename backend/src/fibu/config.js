const fs=require('node:fs');
const {fail}=require('./core');
const names={tc:'TestConsulting CC GmbH',immo:'AC Immo Invest GmbH',holding:'Ceremesiz Holding'};
function loadConfig() {
  if(!process.env.FIBU_CONFIG_PATH) return {companies:{},mode:'disabled'};
  const c=JSON.parse(fs.readFileSync(process.env.FIBU_CONFIG_PATH,'utf8'));
  if(!['local','remote'].includes(c.mode)) fail('Lokalen oder gekoppelten Ausführungsmodus konfigurieren.',503);
  for(const [id,v] of Object.entries(c.companies||{})) {
    if(v.ocrEnabled!==undefined&&typeof v.ocrEnabled!=='boolean')fail('OCR-Freischaltung muss true oder false sein: '+id,503);
    if(v.pilotMode!==undefined&&typeof v.pilotMode!=='boolean')fail('Pilotmodus muss true oder false sein: '+id,503);
    if(!names[id] || !v.root || !v.collectionFolder || !v.accountHolder || !v.iban || !v.documentCompanyName || !Array.isArray(v.allowedUsers)) fail('Unvollständige Firmenkonfiguration: '+id,503);
    if(typeof v.enabled!=='boolean'||v.allowedUsers.some(e=>typeof e!=='string'||!e.includes('@'))||(v.greenCounterparties!==undefined&&(!Array.isArray(v.greenCounterparties)||v.greenCounterparties.some(s=>typeof s!=='string'||!s.trim()))))fail('Ungültige Freischaltung/Benutzer-/Gegenparteienkonfiguration: '+id,503);
    if(id!=='tc' && v.pilotAccepted!==true) v.enabled=false;
  }
  return c;
}
function companyFor(config,user,id,{allowDisabled=false}={}) {
  const c=config.companies?.[id];
  if(!c || (!allowDisabled&&!c.enabled) || !c.allowedUsers.some(e=>e.toLowerCase()===user.email.toLowerCase())) fail('Firma nicht freigeschaltet oder kein Zugriff.',403);
  return c;
}
module.exports={loadConfig,companyFor,names};

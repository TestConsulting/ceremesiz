const path=require('node:path'),{fail}=require('./core'),{validateConfig}=require('./config');
function companySetup(db,config){
 db.exec('CREATE TABLE IF NOT EXISTS fibu_company_setup(company TEXT PRIMARY KEY,payload TEXT NOT NULL,created_by INTEGER NOT NULL,created_at TEXT NOT NULL)');
 const restore=()=>{for(const row of db.prepare('SELECT company,payload FROM fibu_company_setup').all()){if(row.company!=='immo')fail('Unbekannte private Firmenkonfiguration.',503);const value=JSON.parse(row.payload),next=validateConfig({...config,companies:{...config.companies,immo:value}});config.companies=next.companies;}};
 function prepare(body){
  if(config.mode!=='cloud'||!config.companies?.tc?.enabled)fail('Zuerst die Microsoft-Firmenverbindung einrichten.',409);
  if(config.companies.immo?.enabled)fail('AC Immo ist bereits eingerichtet.',409);
  if(body?.cloud?.rootPath!=='Z_AC Immo Invest GmbH'||body.cloud.monthBasePath!=='01. Buchhaltung'||body.microsoftConnectionCompany!=='tc'||body.mailEnabled!==false)fail('Einrichtungsdatei passt nicht zum bestätigten AC-Immo-Suchbereich.',400);
  if(!Array.isArray(body.bankAccounts)||body.bankAccounts.length!==3)fail('Die drei bestätigten Firmenkonten fehlen.',400);
  const bankAccounts=body.bankAccounts.map(a=>{if(typeof a.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(a.id)||typeof a.label!=='string'||!a.label.trim()||a.label.length>160||typeof a.iban!=='string'||a.accountHolder!=='AC Immo Invest GmbH')fail('Ungültige Kontodaten.',400);const iban=a.iban.replace(/\s/g,'').toUpperCase();if(!/^DE\d{20}$/.test(iban)||BigInt(iban.slice(4)+'1314'+iban.slice(2,4))%97n!==1n)fail('IBAN-Prüfziffer ungültig.',400);return {id:a.id,label:a.label.trim(),iban,accountHolder:'AC Immo Invest GmbH'};});
  const value={enabled:true,pilotAccepted:true,pilotMode:false,mailEnabled:false,microsoftConnectionCompany:'tc',ocrEnabled:true,root:path.join(path.dirname(config.companies.tc.root),'immo'),collectionFolder:'collection',accountHolder:'AC Immo Invest GmbH',documentCompanyName:'AC Immo Invest GmbH',iban:bankAccounts[0].iban,bankAccounts,payrollExceptions:false,greenCounterparties:[],cloud:{rootPath:'Z_AC Immo Invest GmbH',monthBasePath:'01. Buchhaltung'}};
  validateConfig({...config,companies:{...config.companies,immo:value}});return value;
 }
 const install=db.transaction((value,actor)=>{if(config.companies.immo?.enabled)fail('AC Immo ist bereits eingerichtet.',409);db.prepare('INSERT INTO fibu_company_setup VALUES(?,?,?,?)').run('immo',JSON.stringify(value),actor,new Date().toISOString());config.companies.immo=value;return {configured:true,companyId:'immo',accounts:value.bankAccounts.map(a=>({id:a.id,label:a.label})),mailEnabled:false};});
 return {restore,prepare,install};
}
module.exports={companySetup};

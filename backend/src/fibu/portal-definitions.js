const {catalog}=require('./portal-catalog'),{fail}=require('./core'),{randomUUID}=require('node:crypto');
const defaultTerms={huk:['HUK'],urban_sports_club:['Urban Sports'],fuelscard:['FuelsCard','B2Mobility'],sachbezug:['Sachbezug','PayCenter']};
function keywords(value){const values=(typeof value==='string'?value.split(/[;\n]/):[]).map(s=>s.trim()).filter(Boolean);if(!values.length||values.length>20||values.some(s=>require('./core').norm(s).length<3||s.length>100))fail('Ein bis zwanzig Suchbegriffe mit mindestens drei Zeichen angeben.',400);return [...new Set(values)];}
function domain(value){const host=String(value).trim().toLowerCase();if(require('node:net').isIP(host)||host.length>253||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)||/\.(?:local|localhost|internal|invalid|test)$/.test(host))fail('Öffentlichen Hostnamen angeben, ohne Pfad oder Port.',400);return host;}
function validate(body){
 if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100)fail('Lieferantennamen angeben (maximal 100 Zeichen).',400);
 let u;try{u=new URL(body.url);if(u.protocol!=='https:'||u.port||u.username||u.password)throw Error();}catch{fail('Gültige HTTPS-Portaladresse angeben.',400);}
 domain(u.hostname);const domains=[...new Set([u.hostname,...(typeof body.domains==='string'?body.domains.split(/[;,\n]/).filter(s=>s.trim()).map(domain):[])])];if(domains.length>10)fail('Maximal zehn freigegebene Hosts.',400);
 return {name:body.name.trim(),url:u.href,domains,keywords:keywords(body.keywords),exactHosts:true,custom:true};
}
function definitions(db){
 db.exec('CREATE TABLE IF NOT EXISTS fibu_portal_definitions(company TEXT NOT NULL,provider TEXT NOT NULL,payload TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(company,provider))');
 function all(company){const entries=new Map(Object.entries(catalog).map(([id,p])=>[id,{...p,keywords:defaultTerms[id]||[p.name],version:0}]));for(const row of db.prepare('SELECT * FROM fibu_portal_definitions WHERE company=?').all(company)){const saved=JSON.parse(row.payload),base=catalog[row.provider];entries.set(row.provider,{...saved,...(base?{domains:base.domains,resourceDomains:base.resourceDomains,exactHosts:base.exactHosts}:{}),version:row.version});}return entries;}
 function get(company,id,{removed=false}={}){const p=all(company).get(id);if(!p||p.removedAt&&!removed)fail('Lieferantenportal nicht vorhanden.',404);return p;}
 function put(company,id,value,expected){return db.transaction(()=>{const old=get(company,id,{removed:true});if(old.version!==expected)fail('Portal wurde inzwischen geändert. Neu laden.',409);db.prepare('INSERT INTO fibu_portal_definitions VALUES(?,?,?,?) ON CONFLICT(company,provider) DO UPDATE SET payload=excluded.payload,version=excluded.version').run(company,id,JSON.stringify(value),old.version+1);return {...value,version:old.version+1};})();}
 return {all,get,put,add(company,b,actor){const p={...validate(b),createdAt:new Date().toISOString(),createdBy:actor};if([...all(company).values()].filter(p=>!p.removedAt).length>=50)fail('Maximal 50 Portale je Firma.',400);const id='custom_'+randomUUID();db.prepare('INSERT INTO fibu_portal_definitions VALUES(?,?,?,1)').run(company,id,JSON.stringify(p));return {id,...p,version:1};}};
}
module.exports={definitions,validate,domain,keywords};

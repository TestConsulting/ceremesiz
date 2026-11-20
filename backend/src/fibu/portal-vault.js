const crypto=require('node:crypto');
const {fail}=require('./core');
function portalVault(db,encodedKey=process.env.FIBU_PORTAL_KEY||process.env.FIBU_TOKEN_KEY){
 const raw=Buffer.from(encodedKey||'','base64'),ready=raw.length===32;
 const key=ready?Buffer.from(crypto.hkdfSync('sha256',raw,Buffer.from('astra-portal-v1'),Buffer.from('supplier-credentials'),32)):null;
 db.exec('CREATE TABLE IF NOT EXISTS fibu_portal_accounts(company TEXT NOT NULL,provider TEXT NOT NULL,payload TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(company,provider)); CREATE TABLE IF NOT EXISTS fibu_portal_status(company TEXT NOT NULL,provider TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(company,provider))');
 function assertReady(){if(!ready)fail('Server-Schlüssel für Portalzugänge fehlt.',503);}
 function get(company,provider){assertReady();const r=db.prepare('SELECT * FROM fibu_portal_accounts WHERE company=? AND provider=?').get(company,provider);if(!r)return null;try{const p=JSON.parse(r.payload),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'base64'));d.setAAD(Buffer.from('astra-portal:'+company+':'+provider));d.setAuthTag(Buffer.from(p.tag,'base64'));return {...JSON.parse(Buffer.concat([d.update(Buffer.from(p.data,'base64')),d.final()]).toString()),version:r.version};}catch{fail('Portalzugang nicht entschlüsselbar. Schlüssel prüfen.',409);}}
 function put(company,provider,value,expected){assertReady();return db.transaction(()=>{const old=db.prepare('SELECT version FROM fibu_portal_accounts WHERE company=? AND provider=?').get(company,provider);if(expected!==undefined&&(old?.version||0)!==expected)fail('Portalzugang wurde inzwischen geändert. Neu laden.',409);const version=(old?.version||0)+1,iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from('astra-portal:'+company+':'+provider));const data=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);db.prepare('INSERT INTO fibu_portal_accounts VALUES(?,?,?,?) ON CONFLICT(company,provider) DO UPDATE SET payload=excluded.payload,version=excluded.version').run(company,provider,JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')}),version);return version;})();}
 return {ready,get,put,ids:company=>db.prepare('SELECT provider FROM fibu_portal_accounts WHERE company=?').all(company).map(r=>r.provider),
 status:(company,provider)=>JSON.parse(db.prepare('SELECT payload FROM fibu_portal_status WHERE company=? AND provider=?').get(company,provider)?.payload||'null'),
 setStatus(company,provider,value){db.prepare('INSERT INTO fibu_portal_status VALUES(?,?,?) ON CONFLICT(company,provider) DO UPDATE SET payload=excluded.payload').run(company,provider,JSON.stringify(value));}};
}
module.exports={portalVault};

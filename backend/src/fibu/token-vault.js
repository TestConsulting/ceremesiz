const crypto=require('node:crypto');
const {fail}=require('./core');
function tokenVault(db,encodedKey=process.env.FIBU_TOKEN_KEY){
 const key=Buffer.from(encodedKey||'','base64');
 if(key.length!==32)fail('Server-Schlüssel für verschlüsselte Microsoft-Verbindung fehlt.',503);
 db.exec('CREATE TABLE IF NOT EXISTS fibu_microsoft_tokens (owner INTEGER NOT NULL, company TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,company))');
 const aad=(o,c)=>Buffer.from('astra-microsoft:'+o+':'+c);
 return {
  get(o,c){
   const row=db.prepare('SELECT payload FROM fibu_microsoft_tokens WHERE owner=? AND company=?').get(o,c);if(!row)return null;
   try{const p=JSON.parse(row.payload),decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'base64'));decipher.setAAD(aad(o,c));decipher.setAuthTag(Buffer.from(p.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(p.data,'base64')),decipher.final()]).toString('utf8'));}
   catch{fail('Gespeicherte Microsoft-Verbindung nicht lesbar. Erneut verbinden.',409);}
  },
  put(o,c,value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(o,c));const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);const payload=JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});db.prepare('INSERT INTO fibu_microsoft_tokens VALUES(?,?,?) ON CONFLICT(owner,company) DO UPDATE SET payload=excluded.payload').run(o,c,payload);},
  delete(o,c){db.prepare('DELETE FROM fibu_microsoft_tokens WHERE owner=? AND company=?').run(o,c);}
 };
}
module.exports={tokenVault};

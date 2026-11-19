// Shared company workspace. Authentication stays in the router; no per-user FiBu permissions.
function sharedStore(db,raw){
 db.exec('CREATE TABLE IF NOT EXISTS fibu_workspaces(company TEXT PRIMARY KEY, owner INTEGER NOT NULL)');
 const primaryOwner=(owner,company)=>{const saved=db.prepare('SELECT owner FROM fibu_workspaces WHERE company=?').get(company);if(saved)return saved.owner;const tokenOwner=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fibu_microsoft_tokens'").get()?db.prepare('SELECT owner FROM fibu_microsoft_tokens WHERE company=? ORDER BY owner LIMIT 1').get(company):null;const first=tokenOwner||db.prepare('SELECT owner FROM fibu_jobs WHERE company=? ORDER BY created,id LIMIT 1').get(company)||db.prepare('SELECT owner FROM fibu_folders WHERE company=? ORDER BY owner LIMIT 1').get(company);const id=first?.owner||owner;db.prepare('INSERT OR IGNORE INTO fibu_workspaces VALUES(?,?)').run(company,id);return db.prepare('SELECT owner FROM fibu_workspaces WHERE company=?').get(company).owner;};
 const owners=(table,company)=>db.prepare('SELECT DISTINCT owner FROM '+table+' WHERE company=? ORDER BY owner').all(company).map(r=>r.owner);
 const existing=(table,owner,company,field,value)=>db.prepare('SELECT owner FROM '+table+' WHERE company=? AND '+field+'=? ORDER BY owner LIMIT 1').get(company,value)?.owner||primaryOwner(owner,company);
 const api={...raw,primaryOwner,
  get:(owner,id)=>{const r=db.prepare('SELECT owner FROM fibu_jobs WHERE id=?').get(id);return r?raw.get(r.owner,id):null;},
  enqueue:(owner,params)=>raw.enqueue(primaryOwner(owner,params.companyId),params),
  list:(owner,company)=>db.prepare('SELECT id,owner FROM fibu_jobs WHERE company=? ORDER BY created DESC LIMIT 100').all(company).map(r=>raw.get(r.owner,r.id)),
  folders:(owner,company,options)=>owners('fibu_folders',company).flatMap(o=>raw.folders(o,company,options)),
  putFolder:(owner,company,id,payload)=>raw.putFolder(existing('fibu_folders',owner,company,'month',id),company,id,payload),
  profileActive:(owner,company,id)=>!!db.prepare("SELECT 1 FROM fibu_jobs WHERE company=? AND state IN ('queued','running') AND COALESCE(json_extract(payload,'$.folderId'),month)=?").get(company,id),
  month:(owner,company,m,profile)=>{const table=profile&&profile!==m?'fibu_profile_months':'fibu_months',field=profile&&profile!==m?'profile':'month',id=profile&&profile!==m?profile:m;return raw.month(existing(table,owner,company,field,id),company,m,profile);},
  putMonth:(owner,company,m,payload,closed=false,profile)=>{const table=profile&&profile!==m?'fibu_profile_months':'fibu_months',field=profile&&profile!==m?'profile':'month',id=profile&&profile!==m?profile:m;return raw.putMonth(existing(table,owner,company,field,id),company,m,payload,closed,profile);},
  imports:(owner,company)=>{const seen=new Set();return owners('fibu_imports',company).flatMap(o=>raw.imports(o,company)).filter(r=>!seen.has(r.hash)&&seen.add(r.hash));},
  putImport:(owner,company,digest,payload)=>raw.putImport(existing('fibu_imports',owner,company,'digest',digest),company,digest,payload),
  documentReview:(owner,company,digest)=>raw.documentReview(existing('fibu_document_reviews',owner,company,'digest',digest),company,digest),
  putDocumentReview:(owner,company,digest,payload)=>raw.putDocumentReview(existing('fibu_document_reviews',owner,company,'digest',digest),company,digest,payload),
  mail:(owner,company,message)=>raw.mail(existing('fibu_mail',owner,company,'message',message),company,message),
  putMail:(owner,company,message,payload)=>raw.putMail(existing('fibu_mail',owner,company,'message',message),company,message,payload),
  mailFile:(owner,company,digest)=>{for(const o of owners('fibu_mail',company)){const file=raw.mailFile(o,company,digest);if(file)return file;}return null;},
  relocateMail:(owner,company,digest,p)=>{for(const o of owners('fibu_mail',company))raw.relocateMail(o,company,digest,p);}
 };
 return api;
}
module.exports={sharedStore};

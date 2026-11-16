const crypto = require('node:crypto');
function createStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS fibu_jobs (
    id TEXT PRIMARY KEY, owner INTEGER NOT NULL, company TEXT NOT NULL, month TEXT NOT NULL,
    state TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS fibu_active ON fibu_jobs(company,month) WHERE state IN ('queued','running');
    CREATE TABLE IF NOT EXISTS fibu_months (owner INTEGER NOT NULL, company TEXT NOT NULL, month TEXT NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, PRIMARY KEY(owner,company,month));
    CREATE TABLE IF NOT EXISTS fibu_profile_months (owner INTEGER NOT NULL, company TEXT NOT NULL, profile TEXT NOT NULL,
      month TEXT NOT NULL, closed INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, PRIMARY KEY(owner,company,profile));
    CREATE TABLE IF NOT EXISTS fibu_mail (owner INTEGER NOT NULL, company TEXT NOT NULL, message TEXT NOT NULL,
      payload TEXT NOT NULL, PRIMARY KEY(owner,company,message));
    CREATE TABLE IF NOT EXISTS fibu_folders (owner INTEGER NOT NULL, company TEXT NOT NULL, month TEXT NOT NULL,
      payload TEXT NOT NULL, PRIMARY KEY(owner,company,month));
    CREATE TABLE IF NOT EXISTS fibu_document_reviews (owner INTEGER NOT NULL, company TEXT NOT NULL, digest TEXT NOT NULL,
      payload TEXT NOT NULL, PRIMARY KEY(owner,company,digest));
    CREATE TABLE IF NOT EXISTS fibu_imports (owner INTEGER NOT NULL, company TEXT NOT NULL, digest TEXT NOT NULL,
      payload TEXT NOT NULL, PRIMARY KEY(owner,company,digest));
    CREATE TABLE IF NOT EXISTS fibu_runner_state (company TEXT PRIMARY KEY, seen TEXT NOT NULL);`);
  const get = (owner,id) => { const r=db.prepare('SELECT * FROM fibu_jobs WHERE id=? AND owner=?').get(id,owner); return r ? {...JSON.parse(r.payload),id:r.id,state:r.state,created:r.created,updated:r.updated}:null; };
  const save = (job,state=job.state) => {
    const now=new Date().toISOString();
    job.cancelRequested=!!(job.cancelRequested||get(job.owner,job.id)?.cancelRequested);
    db.prepare('UPDATE fibu_jobs SET state=?,payload=?,updated=? WHERE id=? AND owner=?').run(state,JSON.stringify({...job,state}),now,job.id,job.owner);
    return get(job.owner,job.id);
  };
  const month = (owner,company,m,profile) => {
    const r=profile&&profile!==m?db.prepare('SELECT * FROM fibu_profile_months WHERE owner=? AND company=? AND profile=?').get(owner,company,profile):db.prepare('SELECT * FROM fibu_months WHERE owner=? AND company=? AND month=?').get(owner,company,m);
    return r ? {...JSON.parse(r.payload),closed:!!r.closed}:null;
  };
  const putMonth = (owner,company,m,payload,closed=false,profile) => profile&&profile!==m?db.prepare(`INSERT INTO fibu_profile_months VALUES(?,?,?,?,?,?) ON CONFLICT(owner,company,profile) DO UPDATE SET payload=excluded.payload,closed=excluded.closed`).run(owner,company,profile,m,closed?1:0,JSON.stringify(payload)):db.prepare(`INSERT INTO fibu_months VALUES(?,?,?,?,?) ON CONFLICT(owner,company,month) DO UPDATE SET payload=excluded.payload,closed=excluded.closed`).run(owner,company,m,closed?1:0,JSON.stringify(payload));
  const isClosed=(company,month,profile)=>!!(profile&&profile!==month?db.prepare('SELECT 1 FROM fibu_profile_months WHERE company=? AND profile=? AND closed=1').get(company,profile):db.prepare('SELECT 1 FROM fibu_months WHERE company=? AND month=? AND closed=1').get(company,month));
  const hasActive=(company,month)=>!!db.prepare("SELECT 1 FROM fibu_jobs WHERE company=? AND month=? AND state IN ('queued','running')").get(company,month);
  const enqueue = db.transaction((owner,params) => {
    if (isClosed(params.companyId,params.month,params.folderId)) throw Object.assign(new Error('Monat ist abgeschlossen. Zuerst ausdrücklich wieder öffnen.'),{status:409});
    const active=db.prepare("SELECT * FROM fibu_jobs WHERE company=? AND month=? AND state IN ('queued','running')").get(params.companyId,params.month);
    if(active) {
      const activeJob=get(active.owner,active.id);
      if(active.owner===owner&&(activeJob.folderId||activeJob.month)===(params.folderId||params.month)) return get(owner,active.id);
      throw Object.assign(new Error('Für diese Firma und diesen Monat läuft bereits eine Prüfung.'),{status:409});
    }
    const now=new Date().toISOString(),id=crypto.randomUUID();
    const job={...params,id,owner,state:'queued',progress:'Auftrag angelegt',events:[{at:now,message:'Manueller Startauftrag'}],issues:[],transactions:[],documents:[],cancelRequested:false};
    db.prepare('INSERT INTO fibu_jobs VALUES(?,?,?,?,?,?,?,?)').run(id,owner,params.companyId,params.month,'queued',JSON.stringify(job),now,now);
    return get(owner,id);
  });
  return { get,save,month,putMonth,enqueue,isClosed,hasActive,
    imports:(owner,company)=>db.prepare('SELECT payload FROM fibu_imports WHERE owner=? AND company=?').all(owner,company).map(r=>JSON.parse(r.payload)),
    putImport:(owner,company,digest,payload)=>db.prepare('INSERT INTO fibu_imports VALUES(?,?,?,?) ON CONFLICT(owner,company,digest) DO UPDATE SET payload=excluded.payload').run(owner,company,digest,JSON.stringify(payload)),
    documentReview:(owner,company,digest)=>{const r=db.prepare('SELECT payload FROM fibu_document_reviews WHERE owner=? AND company=? AND digest=?').get(owner,company,digest);return r?JSON.parse(r.payload):null;},
    putDocumentReview:(owner,company,digest,payload)=>db.prepare('INSERT INTO fibu_document_reviews VALUES(?,?,?,?) ON CONFLICT(owner,company,digest) DO UPDATE SET payload=excluded.payload').run(owner,company,digest,JSON.stringify(payload)),
    folders:(owner,company)=>db.prepare('SELECT month,payload FROM fibu_folders WHERE owner=? AND company=? ORDER BY month DESC').all(owner,company).map(r=>({...JSON.parse(r.payload),id:r.month})),
    putFolder:(owner,company,month,payload)=>db.prepare('INSERT INTO fibu_folders VALUES(?,?,?,?) ON CONFLICT(owner,company,month) DO UPDATE SET payload=excluded.payload').run(owner,company,month,JSON.stringify(payload)),
    adopt:job=>db.prepare('INSERT INTO fibu_jobs VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,payload=excluded.payload,updated=excluded.updated').run(job.id,job.owner,job.companyId,job.month,job.state,JSON.stringify(job),job.created||new Date().toISOString(),new Date().toISOString()),
    list:(owner,company)=>db.prepare('SELECT id FROM fibu_jobs WHERE owner=? AND company=? ORDER BY created DESC LIMIT 50').all(owner,company).map(r=>get(owner,r.id)),
    mail:(owner,company,message)=>{const r=db.prepare('SELECT payload FROM fibu_mail WHERE owner=? AND company=? AND message=?').get(owner,company,message);return r?JSON.parse(r.payload):null;},
    putMail:(owner,company,message,payload)=>db.prepare('INSERT INTO fibu_mail VALUES(?,?,?,?) ON CONFLICT(owner,company,message) DO UPDATE SET payload=excluded.payload').run(owner,company,message,JSON.stringify(payload)),
    relocateMail:(owner,company,digest,newPath)=>{
      for(const row of db.prepare('SELECT message,payload FROM fibu_mail WHERE owner=? AND company=?').all(owner,company)) {
        const data=JSON.parse(row.payload);let changed=false;
        for(const f of data.files||[])if(f.hash===digest&&f.path!==newPath){f.originalStoragePath=f.originalStoragePath||f.path;f.path=newPath;changed=true;}
        if(changed)db.prepare('UPDATE fibu_mail SET payload=? WHERE owner=? AND company=? AND message=?').run(JSON.stringify(data),owner,company,row.message);
      }
    },
    recover:()=>db.prepare("UPDATE fibu_jobs SET state='partial',payload=json_set(payload,'$.progress','Dienst wurde unterbrochen; neuer manueller Lauf erforderlich.','$.issues',json('[\"Dienstunterbrechung: Ablagen vor erneutem Lauf prüfen\"]')) WHERE state IN ('queued','running')").run()
  };
}
module.exports={createStore};

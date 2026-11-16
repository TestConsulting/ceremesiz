const test=require('node:test'),assert=require('node:assert/strict'),Database=require('better-sqlite3'),{createStore}=require('../src/fibu/store');
test('Zwei Einträge für denselben Monat behalten getrennte Ergebnisse und Abschlüsse; laufende Jobs werden nicht dem anderen Eintrag zugerechnet',()=>{
 const db=new Database(':memory:');try{
  const store=createStore(db),params={companyId:'tc',month:'2026-10'};
  store.putMonth(1,'tc','2026-10',{jobId:'original'},true,'profile-a');assert.equal(store.isClosed('tc','2026-10','profile-a'),true);assert.equal(store.isClosed('tc','2026-10','profile-b'),false);
  assert.throws(()=>store.enqueue(1,{...params,folderId:'profile-a'}),/abgeschlossen/);
  const active=store.enqueue(1,{...params,folderId:'profile-b'});assert.equal(store.enqueue(1,{...params,folderId:'profile-b'}).id,active.id);
  assert.throws(()=>store.enqueue(1,{...params,folderId:'profile-c'}),/läuft bereits/);
  store.save(active,'completed');store.putMonth(1,'tc','2026-10',{jobId:active.id},false,'profile-b');assert.equal(store.month(1,'tc','2026-10','profile-a').jobId,'original');assert.equal(store.month(1,'tc','2026-10','profile-b').jobId,active.id);assert.equal(store.month(2,'tc','2026-10','profile-b'),null);
 }finally{db.close();}
});

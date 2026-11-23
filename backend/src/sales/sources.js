const crypto = require('node:crypto');

const sources = {
  freelancermap: { label:'freelancermap', url:'https://www.freelancermap.de/projekte' },
  randstad: { label:'Randstad / GULP', url:'https://www.gulp.de/freelancing/projekte' }
};
const defaults = { revision:0, sources:Object.keys(sources), keywords:['Selenium','Tester','Testmanager'], times:['08:00','15:00'], timezone:'Europe/Berlin' };
const error = (message,status) => Object.assign(new Error(message),{status});

module.exports=function createSources(db,probe=fetch) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS sales_source_config (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);'+
    'CREATE TABLE IF NOT EXISTS sales_source_checks (id TEXT PRIMARY KEY, started TEXT NOT NULL, finished TEXT, payload TEXT NOT NULL);'+
    'CREATE UNIQUE INDEX IF NOT EXISTS sales_one_source_check ON sales_source_checks((1)) WHERE finished IS NULL;'
  );
  const readConfig=db.prepare('SELECT payload FROM sales_source_config WHERE id=1');
  const getConfig=()=>JSON.parse(readConfig.get()?.payload||JSON.stringify(defaults));
  const active=db.prepare('SELECT * FROM sales_source_checks WHERE finished IS NULL');
  const saveResult=db.prepare('UPDATE sales_source_checks SET payload=?,finished=? WHERE id=? AND finished IS NULL');
  function recent() {
    const r=db.prepare('SELECT * FROM sales_source_checks ORDER BY started DESC LIMIT 1').get();
    return r?{id:r.id,started:r.started,finished:r.finished,...JSON.parse(r.payload)}:null;
  }
  const save=db.transaction(input=>{
    const current=getConfig();
    if(input.revision!==current.revision)throw error('Konfiguration wurde geändert. Bitte neu laden.',409);
    const config={...defaults,revision:current.revision+1,sources:input.sources,keywords:input.keywords,times:input.times};
    db.prepare('INSERT INTO sales_source_config VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
      .run(JSON.stringify(config));
    return config;
  });
  const create=db.transaction(()=>{
    const last=active.get();
    if(last) {
      if(Date.now()-Date.parse(last.started)<60_000)throw error('Eine Quellenprüfung läuft bereits.',409);
      const stale=JSON.parse(last.payload);
      for(const source of stale.sources)if(['pending','running'].includes(source.state)){
        source.state='failed';source.message='Prüfung wurde unterbrochen.';
      }
      saveResult.run(JSON.stringify(stale),new Date().toISOString(),last.id);
    }
    const config=getConfig();
    if(!config.sources.length)throw error('Mindestens eine Quelle aktivieren.',400);
    const record={
      id:crypto.randomUUID(), started:new Date().toISOString(), finished:null,
      sources:config.sources.map(key=>({key,state:'pending',message:''}))
    };
    db.prepare('INSERT INTO sales_source_checks VALUES(?,?,NULL,?)')
      .run(record.id,record.started,JSON.stringify({sources:record.sources}));
    return record;
  });
  function start() {
    const record=create.immediate();
    const update=()=>saveResult.run(JSON.stringify({sources:record.sources}),record.finished,record.id);
    (async()=>{
      for(const result of record.sources) {
        result.state='running';update();
        try{
          const response=await probe(sources[result.key].url,{signal:AbortSignal.timeout(8000),redirect:'error'});
          if(response.body)await response.body.cancel().catch(()=>{});
          result.state=response.ok?'manual':'failed';
          result.message=response.ok?'Öffentliche Projektbörse erreichbar. Firmenanmeldung und Recherche im Portal durchführen.':
            'Projektbörse antwortet mit HTTP '+response.status+'.';
        }catch{
          result.state='failed';result.message='Projektbörse war aus dieser Umgebung nicht erreichbar.';
        }
        update();
      }
      record.finished=new Date().toISOString();update();
    })().catch(()=>{ /* Offene Prüfung wird beim nächsten Start nach Ablauf als unterbrochen erfasst. */ });
    return record.id;
  }
  return { definitions:sources, getConfig, save, recent, start };
};

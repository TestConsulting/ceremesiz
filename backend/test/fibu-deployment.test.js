const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {configure}=require('../scripts/configure-fibu.cjs');
test('Jenkins-Konfiguration bewahrt bestehende Login-Werte und sichert private Konfiguration',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'astra-config-'));
 try{
  fs.writeFileSync(path.join(root,'.env'),'SESSION_SECRET=synthetic-session\nFRONTEND_ORIGINS=https://example.invalid\nFIBU_RUNNER_SECRET=old\n');
  const config={mode:'remote',microsoft:{tenantId:'synthetic-tenant',clientId:'synthetic-client'},companies:{tc:{enabled:true,pilotMode:true,allowedUsers:['pilot@example.invalid']}}};
  const runnerSecret='x'.repeat(43);assert.equal(configure(root,{config,runnerSecret}).configured,true);
  const env=fs.readFileSync(path.join(root,'.env'),'utf8');assert.match(env,/SESSION_SECRET=synthetic-session/);assert.equal(env.split('FIBU_RUNNER_SECRET=').length,2);assert.ok(fs.readdirSync(path.join(root,'data')).some(n=>n.startsWith('fibu-env-backup-')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'data/fibu.config.json'),'utf8')),config);
  assert.throws(()=>configure(root,{config:{...config,mode:'local'},runnerSecret}));assert.throws(()=>configure(root,{config,runnerSecret:'weak'}));
  const cloud={...config,mode:'cloud',companies:{tc:{...config.companies.tc,cloud:{rootPath:'SyntheticCompany'}}}};
  assert.equal(configure(root,{config:cloud}).mode,'cloud');const cloudEnv=fs.readFileSync(path.join(root,'.env'),'utf8');assert.ok(!cloudEnv.includes('FIBU_RUNNER_SECRET='));const key=cloudEnv.match(/^FIBU_TOKEN_KEY=(.+)$/m)[1];assert.equal(Buffer.from(key,'base64').length,32);
  cloud.companies.immo={pilotMode:true};assert.equal(configure(root,{config:cloud},{tcPilotMode:false}).pilotMode,false);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'data/fibu.config.json'),'utf8')).companies.tc.pilotMode,false);assert.equal(cloud.companies.immo.pilotMode,true);assert.throws(()=>configure(root,{config:cloud},{tcPilotMode:'invalid'}));
  configure(root,{config:cloud});assert.equal(fs.readFileSync(path.join(root,'.env'),'utf8').match(/^FIBU_TOKEN_KEY=(.+)$/m)[1],key);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

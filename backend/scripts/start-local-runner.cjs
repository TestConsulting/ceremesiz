// Started manually; polls explicit jobs only. No task scheduler or automatic scans.
const fs=require('node:fs'),path=require('node:path');
const file=process.env.FIBU_RUNNER_PRIVATE_FILE||path.join(__dirname,'../data/fibu-runner.private.json');
try{
 const c=JSON.parse(fs.readFileSync(file,'utf8'));
 process.env.FIBU_PORTAL_URL=c.portalUrl;
 process.env.FIBU_RUNNER_SECRET=c.runnerSecret;
 process.env.FIBU_RUNNER_COMPANY=c.companyId;
 process.env.FIBU_CONFIG_PATH=c.configPath;
 require('../src/fibu/runner').main().catch(()=>{console.error('Windows-Kopplung fehlgeschlagen. Private Konfiguration prüfen.');process.exitCode=1;});
}catch{console.error('Private Windows-Kopplung fehlt.');process.exitCode=1;}

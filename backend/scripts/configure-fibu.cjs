// Run by the existing Jenkins job with a masked Secret Text binding.
// No credential is accepted as an argument or printed to a build log.
const fs=require('node:fs'),path=require('node:path');
function configure(root,payload,{tcPilotMode}={}){
 const {config,runnerSecret}=payload;
 if(!['remote','cloud'].includes(config?.mode)||!config.companies?.tc?.enabled||(config.mode==='remote'&&! /^[A-Za-z0-9_-]{43,128}$/.test(runnerSecret||'')))throw Error('Ungültige private FIBU-Konfiguration.');
 if(!config.microsoft?.tenantId||!config.microsoft?.clientId)throw Error('Firmenbenutzer oder Microsoft-App fehlen.');
 if(tcPilotMode!==undefined){if(typeof tcPilotMode!=='boolean')throw Error('Ungültiger TestConsulting-Pilotmodus.');config.companies.tc.pilotMode=tcPilotMode;}
 const data=path.join(root,'data'),file=path.join(data,'fibu.config.json'),env=path.join(root,'.env');
 fs.mkdirSync(data,{recursive:true});
 if(!fs.existsSync(env))throw Error('Bestehende Server-.env fehlt; keine neue Login-Konfiguration anlegen.');
 const envText=fs.readFileSync(env,'utf8');let tokenKey;
 if(config.mode==='cloud'){
  require('../src/fibu/onedrive').cleanPath(config.companies.tc.cloud?.rootPath);
  tokenKey=envText.match(/^FIBU_TOKEN_KEY=(.+)$/m)?.[1]?.trim();if(tokenKey&&Buffer.from(tokenKey,'base64').length!==32)throw Error('Vorhandener Token-Schlüssel ungültig.');
  config.companies.tc.root='/app/backend/data/fibu-cloud/tc';
  for(const folder of [path.join(data,'fibu-cloud'),path.join(data,'fibu-cloud','tc')]){fs.mkdirSync(folder,{recursive:true,mode:0o700});if(process.platform!=='win32'&&process.getuid?.()===0)fs.chownSync(folder,1000,1000);}
 }
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const backup=path.join(data,'fibu-env-backup-'+stamp);fs.copyFileSync(env,backup);fs.chmodSync(backup,0o600);
 if(fs.existsSync(file))fs.copyFileSync(file,path.join(data,'fibu-config-backup-'+stamp+'.json'));
 fs.writeFileSync(file,JSON.stringify(config,null,2),{mode:0o600});fs.chmodSync(file,0o600);
 if(process.platform!=='win32'&&process.getuid?.()===0)fs.chownSync(file,1000,1000);
 const existing=envText.split(/\r?\n/).filter(l=>!/^\s*(FIBU_CONFIG_PATH|FIBU_RUNNER_SECRET|FIBU_RUNNER_COMPANY)=/.test(l));
 existing.push('FIBU_CONFIG_PATH=/app/backend/data/fibu.config.json');
 if(config.mode==='remote')existing.push('FIBU_RUNNER_COMPANY=tc','FIBU_RUNNER_SECRET='+runnerSecret);
 if(config.mode==='cloud'&&!tokenKey)existing.push('FIBU_TOKEN_KEY='+require('node:crypto').randomBytes(32).toString('base64'));
 fs.writeFileSync(env,existing.join('\n')+'\n');
 return {configured:true,company:'tc',mode:config.mode,pilotMode:config.companies.tc.pilotMode===true};
}
if(require.main===module){try{const value=process.env.ASTRA_FIBU_BOOTSTRAP;if(!value)throw Error('Jenkins Secret-Text-Binding fehlt.');console.log(JSON.stringify(configure(path.resolve(__dirname,'..'),JSON.parse(value),{tcPilotMode:process.env.ASTRA_TC_PILOT_MODE===undefined?undefined:process.env.ASTRA_TC_PILOT_MODE==='false'?false:process.env.ASTRA_TC_PILOT_MODE==='true'?true:'invalid'})));}catch{console.error('Private FIBU-Konfiguration konnte nicht sicher angewendet werden.');process.exitCode=1;}}
module.exports={configure};

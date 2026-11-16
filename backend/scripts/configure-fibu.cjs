// Run by the existing Jenkins job with a masked Secret Text binding.
// No credential is accepted as an argument or printed to a build log.
const fs=require('node:fs'),path=require('node:path');
function configure(root,payload){
 const {config,runnerSecret}=payload;
 if(config?.mode!=='remote'||!config.companies?.tc?.enabled||! /^[A-Za-z0-9_-]{43,128}$/.test(runnerSecret||''))throw Error('Ungültige private FIBU-Kopplung.');
 if(!config.companies.tc.allowedUsers?.length||!config.microsoft?.tenantId||!config.microsoft?.clientId)throw Error('Firmenbenutzer oder Microsoft-App fehlen.');
 const data=path.join(root,'data'),file=path.join(data,'fibu.config.json'),env=path.join(root,'.env');
 fs.mkdirSync(data,{recursive:true});
 if(!fs.existsSync(env))throw Error('Bestehende Server-.env fehlt; keine neue Login-Konfiguration anlegen.');
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const backup=path.join(data,'fibu-env-backup-'+stamp);fs.copyFileSync(env,backup);fs.chmodSync(backup,0o600);
 if(fs.existsSync(file))fs.copyFileSync(file,path.join(data,'fibu-config-backup-'+stamp+'.json'));
 fs.writeFileSync(file,JSON.stringify(config,null,2),{mode:0o600});fs.chmodSync(file,0o600);
 if(process.platform!=='win32'&&process.getuid?.()===0)fs.chownSync(file,1000,1000);
 const existing=fs.readFileSync(env,'utf8').split(/\r?\n/).filter(l=>!/^\s*(FIBU_CONFIG_PATH|FIBU_RUNNER_SECRET|FIBU_RUNNER_COMPANY)=/.test(l));
 existing.push('FIBU_CONFIG_PATH=/app/backend/data/fibu.config.json','FIBU_RUNNER_COMPANY=tc','FIBU_RUNNER_SECRET='+runnerSecret);
 fs.writeFileSync(env,existing.join('\n')+'\n');
 return {configured:true,company:'tc',mode:'remote',pilotMode:config.companies.tc.pilotMode===true};
}
if(require.main===module){try{const value=process.env.ASTRA_FIBU_BOOTSTRAP;if(!value)throw Error('Jenkins Secret-Text-Binding fehlt.');console.log(JSON.stringify(configure(path.resolve(__dirname,'..'),JSON.parse(value))));}catch{console.error('Private FIBU-Konfiguration konnte nicht sicher angewendet werden.');process.exitCode=1;}}
module.exports={configure};

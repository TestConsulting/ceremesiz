const {setTimeout:wait}=require('node:timers/promises');
async function checkpoint(job,store,{delay=()=>wait(500)}={}){
 let stored=store.get(job.owner,job.id);
 if(stored?.cancelRequested)throw Object.assign(Error('Vom Nutzer abgebrochen; bereits erfolgte Ablagen bleiben erhalten.'),{cancelled:true});
 if(!stored?.pauseRequested)return;
 job.pauseStartedAt=new Date().toISOString();job.paused=true;store.save(job);
 while((stored=store.get(job.owner,job.id))?.pauseRequested){
  if(stored.cancelRequested)throw Object.assign(Error('Vom Nutzer abgebrochen.'),{cancelled:true});
  await delay();
 }
 job.pausedMs=(job.pausedMs||0)+Math.max(0,Date.now()-Date.parse(job.pauseStartedAt));job.pauseStartedAt=null;job.paused=false;store.save(job);
 if(stored?.cancelRequested)throw Object.assign(Error('Vom Nutzer abgebrochen.'),{cancelled:true});
}
module.exports={checkpoint};

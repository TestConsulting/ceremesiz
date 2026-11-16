const stages={download:[0,15,'OneDrive laden'],mail:[15,65,'E-Post prüfen'],documents:[65,85,'Belege prüfen'],match:[85,94,'Buchungen zuordnen'],export:[94,97,'PDF erstellen'],publish:[97,100,'OneDrive-PDF aktualisieren'],done:[100,100,'Prüfung beendet']};
function advance(job,store,stage,done=0,total=0){
 const [start,end,label]=stages[stage],previous=job.workProgress||{};
 const fraction=total>0?Math.max(0,Math.min(1,done/total)):0;
 job.workProgress={stage,label,done,total,percent:Math.max(previous.percent||0,Math.floor(start+(end-start)*fraction)),startedAt:previous.startedAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
 store.save(job,store.get(job.owner,job.id)?.state||job.state);
}
module.exports={advance};

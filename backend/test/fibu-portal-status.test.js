const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../private/fibu-cockpit.js'),'utf8');
const {fibuPortalStatus:label,fibuPortalReason:reason}=vm.runInNewContext(source.slice(source.indexOf('function fibuPortalStatus('),source.indexOf('async function viewFibuPortals('))+'\n({fibuPortalStatus,fibuPortalReason})');
test('Portal outcome distinguishes current failure from historical success and retains the smaller reason',()=>{
 const a={status:{state:'failed',message:'Anmeldebutton nicht gefunden'},lastPortalSuccessAt:'2026-11-22T12:00:00Z'};
 assert.equal(label(a),'Nicht erfolgreich');assert.equal(reason(a),a.status.message);
 assert.equal(label({...a,status:{state:'tested'}}),'Erfolgreich');
 assert.equal(label({...a,blockedBySupplier:true,status:{state:'tested'}}),'Nicht erfolgreich');
 assert.equal(label({...a,status:{state:'running'}}),'Prüfung läuft');
 assert.equal(label({...a,status:{state:'interaction_required',waitingCode:true}}),'Prüfung läuft');
 assert.equal(label({...a,status:{state:'ready'}}),'Noch nicht geprüft');
 assert.equal(label({...a,lastPortalSuccessAt:null,status:{state:'no_documents'}}),'Nicht erfolgreich');
});

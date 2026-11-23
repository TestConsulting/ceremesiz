const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const createStore = require('../src/sales/store');
const docs = require('../src/sales/documents');

test('Geschützter Vertriebsablauf erhält Versionen und verhindert doppelte Einreichungen', async () => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'astra-vertrieb-test-'));
  const location=path.join(folder,'pilot.sqlite');
  let db=new Database(location);
  try {
    let store=createStore(db);
    const employee={name:'Jana Beispiel',role:'QA Engineer',available:'2027-01-04',bench:true,eligible:true};
    const e=store.saveEmployee('',employee);
    const hidden=store.saveEmployee('',{...employee,name:'Nicht auf Bench',bench:false});
    const bytes=await docs.pdf('2025 Selenium bei Beispiel AG');
    const file={name:'master.pdf',type:'application/pdf',content:bytes,evidence:'2025 Selenium bei Beispiel AG'};
    const m=store.addMaster(e.id,file,0,1);
    store.addMaster(hidden.id,file,0,1);
    assert.throws(()=>store.addMaster(e.id,file,0,1),{status:409});
    const input={title:'QA-Pilot',source:'Randstad/GULP',supplier:'Randstad',reference:'RP-2026-001',original:'QA und Selenium',
      requirements:[{kind:'Muss',text:'Selenium'},{kind:'Kann',text:'Cypress'}]};
    const p=store.importProject(input).project;
    assert.equal(store.importProject({...input,original:'Redaktionell überarbeitet'}).duplicate,true);
    const matches=store.suggestions(p.id);
    assert.deepEqual(matches.map(x=>x.id),[e.id]);
    assert.equal(matches[0].matching[0].evidence,'2025 Selenium bei Beispiel AG');
    assert.equal(matches[0].matching[1].rating,'Offen');
    const draft={channel:'Portal',recipient:'Randstad',letter:'Bewerbung auf RP-2026-001',
      candidates:[{employee:e.id,master:m.id,content:file.evidence,rateCents:null,start:'',terms:''}]};
    let review=store.saveOffer(p.id,p.revision,draft,1);
    assert.throws(()=>store.approve(p.id,review.revision,1),{status:400});
    draft.candidates[0]={...draft.candidates[0],rateCents:9500,start:'2027-01-04'};
    review=store.saveOffer(p.id,review.revision,draft,1);
    const oldCV=review.offer.candidates[0].cv;
    const approved=store.approve(p.id,review.revision,1);
    const current=store.saveOffer(p.id,approved.revision,{...draft,letter:'Geändertes Anschreiben'},1);
    assert.equal(current.approval,null);
    assert.throws(()=>store.confirmManual(p.id,approved.revision,1,'Quittung'),{status:409});
    assert.throws(()=>store.confirmManual(p.id,current.revision,1,'Quittung'),{status:409});
    const changed=store.saveOffer(p.id,current.revision,{...draft,candidates:[{...draft.candidates[0],content:'Selenium bei Beispiel AG (2025)'}]},1);
    const final=store.approve(p.id,changed.revision,1);
    const sent=store.confirmManual(p.id,final.revision,1,'Portalbestätigung RP-2026-001');
    assert.throws(()=>store.confirmManual(p.id,sent.revision,1,'Doppelt'),{status:409});
    store.addMaster(e.id,{...file,content:await docs.pdf('2026 Selenium in einem anderen Projekt')},1,1);
    db.close();
    db=new Database(location);
    store=createStore(db);
    assert.deepEqual(store.master(m.id).content,bytes);
    assert.equal(store.cv(oldCV).content,file.evidence);
    assert.equal(store.history(e.id).length,2);
    assert.equal(store.findProject(p.id).shipment.documents[0],sent.offer.candidates[0].cv);
    assert.equal(docs.word('QA & Selenium').subarray(0,2).toString(),'PK');
  } finally {
    db.close();
    fs.rmSync(folder,{recursive:true,force:true});
  }
});

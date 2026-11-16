const test=require('node:test'),assert=require('node:assert/strict');
const {validateReview,applyReview}=require('../src/fibu/review');
const {createStore}=require('../src/fibu/store');
const Database=require('better-sqlite3');
test('Belegprüfung benötigt Firmenbestätigung und bleibt an Benutzer, Firma und Hash gebunden',()=>{
 const c={documentCompanyName:'TestConsulting CC GmbH'},body={companyName:c.documentCompanyName,amount:136.45,currency:'EUR',supplier:'Microsoft',invoice:'INV12345',reason:'Am Original geprüft',confirmOriginal:true};
 for(const change of [{confirmOriginal:false},{companyName:'Andere GmbH'},{currency:'USD'},{amount:NaN},{amount:-1},{amount:1.234},{invoiceDate:'2026-02-30'}])assert.throws(()=>validateReview({...body,...change},c));
 const review=validateReview(body,c),doc={verified:false,requiresReview:true,amounts:[],supplier:'',invoice:''};
 assert.equal(applyReview(doc,review,c).verified,true);assert.equal(applyReview(doc,review,c).requiresReview,false);assert.equal(applyReview(doc,review,{documentCompanyName:'AC Immo Invest GmbH'}).verified,false);
 const db=new Database(':memory:');try{const store=createStore(db);store.putDocumentReview(1,'tc','hash1',review);assert.deepEqual(store.documentReview(1,'tc','hash1'),review);assert.equal(store.documentReview(2,'tc','hash1'),null);assert.equal(store.documentReview(1,'immo','hash1'),null);assert.equal(store.documentReview(1,'tc','hash2'),null);}finally{db.close();}
});

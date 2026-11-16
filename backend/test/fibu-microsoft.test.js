const test=require('node:test');
const assert=require('node:assert/strict');
const {microsoft}=require('../src/fibu/microsoft');
test('Geräteanmeldung akzeptiert verifizierte Microsoft-Domänen und sperrt fremde Anmeldeziele',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../private/fibu.js'),'utf8');
 const helper=source.match(/function fibuVerificationUrl\(value\)\{[^\n]+\}/)[0];
 const context={URL};require('node:vm').runInNewContext(helper+';this.check=fibuVerificationUrl',context);
 assert.equal(context.check('https://login.microsoft.com/device'),'https://login.microsoft.com/device');
 assert.equal(context.check('https://microsoft.com/devicelogin'),'https://microsoft.com/devicelogin');
 for(const url of ['https://login.microsoft.com.evil.invalid/device','http://login.microsoft.com/device','https://user:pass@login.microsoft.com/device','https://login.microsoft.com:8443/device'])assert.throws(()=>context.check(url));
});
test('Graph-Protokolladapter: ASTRA-Schreibweise, bestehende Kategorien und ETag bleiben erhalten (Mock)',async()=>{
 const originalFetch=global.fetch,originalNow=Date.now;let now=originalNow(),patch;
 Date.now=()=>now;
 global.fetch=async(url,options)=>{
  const u=String(url);
  if(u.endsWith('/devicecode')){assert.equal(options.body.get('scope'),'offline_access User.Read Mail.ReadWrite.Shared');return Response.json({device_code:'synthetic-device',user_code:'TEST-CODE',verification_uri:'https://microsoft.com/devicelogin',interval:5,expires_in:900});}
  if(u.endsWith('/token'))return Response.json({access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_in:3600});
  assert.equal(options.headers.Authorization,'Bearer synthetic-token');assert.equal(options.redirect,'error');
  if(options.method==='PATCH'){patch={body:JSON.parse(options.body),headers:options.headers};return Response.json({id:'m1'});}
  if(u.includes('/me?'))return Response.json({displayName:'Synthetic User',mail:'pilot@example.invalid'});
  if(u.includes('/mailFolders/inbox?'))return Response.json({displayName:'Inbox',totalItemCount:12});
  if(u.includes('mailFolders/inbox'))return Response.json({value:[{id:'m1',categories:['ASTRA','Buchhaltung']}]});
  if(u.includes('$select=categories'))return Response.json({categories:['Buchhaltung','Wichtig'],'@odata.etag':'synthetic-etag'});
  throw Error('Unexpected mock request: '+u);
 };
 try{
  const ms=microsoft({microsoft:{tenantId:'example.onmicrosoft.com',clientId:'00000000-0000-0000-0000-000000000000'}});
  assert.equal(ms.connected(1,'tc'),false);await ms.begin(1,'tc');assert.deepEqual(await ms.poll(1,'tc'),{connected:false});now+=6000;assert.deepEqual(await ms.poll(1,'tc'),{connected:true});
  await ms.list(1,'tc','epost@example.invalid');await ms.complete(1,'tc','epost@example.invalid','m1');
  const proof=await ms.probe(1,'tc','epost@example.invalid');assert.equal(proof.user.email,'pilot@example.invalid');assert.equal(proof.inbox.itemCount,12);assert.equal(proof.mailbox,'epost@example.invalid');
  assert.deepEqual(patch.body.categories,['Buchhaltung','Wichtig','ASTRA']);assert.deepEqual(patch.body.flag,{flagStatus:'complete'});assert.equal(patch.headers['If-Match'],'synthetic-etag');
  ms.disconnect(1,'tc');assert.equal(ms.connected(1,'tc'),false);
 }finally{global.fetch=originalFetch;Date.now=originalNow;}
});

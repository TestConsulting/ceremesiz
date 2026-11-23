const assert=require('node:assert/strict');
const test=require('node:test');
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astra-sales-http-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.SALES_PILOT_USERS='sales-pilot@example.invalid';
process.env.SALES_APPROVER_USERS='sales-pilot@example.invalid';
process.env.SALES_PORTAL_KEY=require('node:crypto').randomBytes(32).toString('base64');
const { createApp }=require('../src/app');
const { upsertUser }=require('../src/users');
const db=require('../src/db');
const docs=require('../src/sales/documents');

test('Vertriebsrouten schützen echte Dokumente und schreiben nur mit CSRF', async () => {
  const password='NurLokalerHTTPTest42!';
  await upsertUser({email:'sales-pilot@example.invalid',firstName:'Sales',lastName:'Pilot',password});
  await upsertUser({email:'other@example.invalid',firstName:'Other',lastName:'Pilot',password});
  const server=createApp({sessionSecret:'test-only-long-session-secret'}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const auth=async email=>{
    const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',origin},
      body:JSON.stringify({email,password})});
    assert.equal(r.status,200);
    const cookie=r.headers.get('set-cookie').split(';')[0];
    const page=await fetch(origin+'/intern',{headers:{cookie}});
    const html=await page.text();
    const boot=JSON.parse(/window\.__BOOT__=(.+?)<\/script>/.exec(html)[1]);
    return {cookie,csrf:boot.csrfToken,pilot:boot.salesPilot};
  };
  try{
    const url=origin+'/api/sales/employees';
    assert.equal((await fetch(url)).status,401);
    const other=await auth('other@example.invalid');
    assert.equal(other.pilot,false);
    assert.equal((await fetch(url,{headers:{cookie:other.cookie}})).status,403);
    const pilot=await auth('sales-pilot@example.invalid');
    assert.equal(pilot.pilot,true);
    const headers={cookie:pilot.cookie,'Content-Type':'application/json',origin};
    const e={name:'Testperson',role:'Testmanager',bench:true,eligible:true};
    const post=(endpoint,body,csrf=true)=>fetch(origin+endpoint,{method:'POST',headers:csrf?{...headers,'X-CSRF-Token':pilot.csrf}:headers,body:JSON.stringify(body)});
    assert.equal((await post('/api/sales/employees',e,false)).status,403);
    const employee=await post('/api/sales/employees',e);
    assert.equal(employee.status,200);
    const {id}=await employee.json();
    const word=docs.word('2025 Selenium & Testmanagement');
    const upload=await post('/api/sales/employees/'+id+'/masters',{version:0,name:'Master.docx',content:word.toString('base64')});
    assert.equal(upload.status,201);
    const master=(await upload.json()).id;
    assert.equal((await fetch(origin+'/api/sales/masters/'+master,{headers:{cookie:other.cookie}})).status,403);
    const original=await fetch(origin+'/api/sales/masters/'+master,{headers:{cookie:pilot.cookie}});
    assert.match(original.headers.get('content-disposition'),/attachment/);
    assert.deepEqual(Buffer.from(await original.arrayBuffer()),word);
    const preview=await fetch(origin+'/api/sales/masters/'+master+'/preview',{headers:{cookie:pilot.cookie}});
    assert.equal((await preview.json()).evidence,'2025 Selenium & Testmanagement');
    const settings=await fetch(origin+'/api/sales/sources',{headers:{cookie:pilot.cookie}});
    assert.deepEqual((await settings.json()).config.keywords,['Selenium','Tester','Testmanager']);
    const accessPath='/api/sales/sources/freelancermap/credentials';
    const accessInput={username:'pilot@example.invalid',password:'SyntheticPortalPassword!',version:0};
    assert.equal((await post(accessPath,accessInput,false)).status,403);
    const savedAccess=await post(accessPath,accessInput);
    assert.equal(savedAccess.status,200);
    const summary={configured:true,username:accessInput.username,version:1};
    assert.deepEqual(await savedAccess.json(),summary);
    const row=db.prepare("SELECT payload FROM fibu_portal_accounts WHERE company='sales' AND provider='freelancermap'").get();
    assert.ok(!row.payload.includes(accessInput.password));
    assert.ok(!row.payload.includes(accessInput.username));
    const update=await post(accessPath,{...accessInput,password:'',version:1});
    assert.deepEqual(await update.json(),{...summary,version:2});
    assert.equal((await post(accessPath,{...accessInput,password:'',username:'different@example.invalid',version:2})).status,400);
    assert.equal((await post(accessPath,accessInput)).status,409);
    process.env.SALES_PILOT_USERS='*';
    const readonlyServer=createApp({sessionSecret:'test-only-long-session-secret'}).listen(0,'127.0.0.1');
    await new Promise(resolve=>readonlyServer.once('listening',resolve));
    try{
      const readonlyOrigin='http://127.0.0.1:'+readonlyServer.address().port;
      assert.equal((await fetch(readonlyOrigin+'/api/sales/employees',{headers:{cookie:other.cookie}})).status,200);
      const publicSettings=await (await fetch(readonlyOrigin+'/api/sales/sources',{headers:{cookie:other.cookie}})).json();
      assert.deepEqual(publicSettings.credentials.freelancermap,{configured:true,username:'',version:0});
      const edit=await fetch(readonlyOrigin+'/api/sales/employees',{method:'POST',
        headers:{cookie:other.cookie,'Content-Type':'application/json','X-CSRF-Token':other.csrf},
        body:JSON.stringify(e)});
      assert.equal(edit.status,403);
    }finally{await new Promise(resolve=>readonlyServer.close(resolve));}
    const fibu=await fetch(origin+'/api/fibu/companies',{headers:{cookie:pilot.cookie}});
    assert.equal(fibu.status,200);
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});

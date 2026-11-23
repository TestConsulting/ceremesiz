const assert=require('node:assert/strict');
const test=require('node:test');
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astra-sales-http-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.SALES_PILOT_USERS='sales-pilot@example.invalid';
process.env.SALES_APPROVER_USERS='sales-pilot@example.invalid';
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
    process.env.SALES_PILOT_USERS='*';
    const readonlyServer=createApp({sessionSecret:'test-only-long-session-secret'}).listen(0,'127.0.0.1');
    await new Promise(resolve=>readonlyServer.once('listening',resolve));
    try{
      const readonlyOrigin='http://127.0.0.1:'+readonlyServer.address().port;
      assert.equal((await fetch(readonlyOrigin+'/api/sales/employees',{headers:{cookie:other.cookie}})).status,200);
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

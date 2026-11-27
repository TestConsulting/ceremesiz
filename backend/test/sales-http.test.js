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

test('Angemeldete Konten teilen sich Vertrieb und Aufgabenboard', async () => {
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
    assert.equal(other.pilot,true);
    assert.equal((await fetch(url,{headers:{cookie:other.cookie}})).status,200);
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
    const sharedMaster=await fetch(origin+'/api/sales/masters/'+master,{headers:{cookie:other.cookie}});
    assert.deepEqual(Buffer.from(await sharedMaster.arrayBuffer()),word);
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
    const publicSettings=await (await fetch(origin+'/api/sales/sources',{headers:{cookie:other.cookie}})).json();
    assert.deepEqual(publicSettings.credentials.freelancermap,{configured:true,username:'',version:0});
    const edit=await fetch(url,{method:'POST',headers:{cookie:other.cookie,'Content-Type':'application/json','X-CSRF-Token':other.csrf},
      body:JSON.stringify(e)});
    assert.equal(edit.status,403);
    const boardUrl=origin+'/api/task-board';
    const readBoard=async user=>(await fetch(boardUrl,{headers:{cookie:user.cookie}})).json();
    const putBoard=(user,revision,board,csrf=user.csrf)=>fetch(boardUrl,{method:'PUT',
      headers:{cookie:user.cookie,'Content-Type':'application/json','X-CSRF-Token':csrf,origin},
      body:JSON.stringify({revision,board})});
    const board={cols:[{id:'open',n:'Offen'}],people:[],cos:[],
      cards:[{id:'ticket1',col:'open',t:'Gemeinsame Aufgabe',d:'',co:'',who:[],due:'',prio:'mittel',cl:[]}]};
    assert.equal((await fetch(boardUrl)).status,401);
    assert.deepEqual(await readBoard(pilot),{revision:0,board:null});
    assert.equal((await putBoard(pilot,0,board,'')).status,403);
    assert.deepEqual(await (await putBoard(pilot,0,board)).json(),{revision:1});
    assert.deepEqual(await readBoard(other),{revision:1,board});
    const updated=structuredClone(board);
    updated.cards[0].t='Von anderem Konto geändert';
    updated.cards[0].completed=true;
    updated.cards[0].archived=true;
    const conflict=await putBoard(other,0,updated);
    assert.equal(conflict.status,409);
    assert.deepEqual((await conflict.json()).board,board);
    assert.deepEqual(await (await putBoard(other,1,updated)).json(),{revision:2});
    assert.deepEqual(await readBoard(pilot),{revision:2,board:updated});
    updated.cards[0].archived=false;
    assert.deepEqual(await (await putBoard(pilot,2,updated)).json(),{revision:3});
    assert.deepEqual(await readBoard(other),{revision:3,board:updated});
    const files=boardUrl+'/cards/ticket1/attachments';
    const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(2*1024*1024)]);
    const uploadFile=(user,name,csrf=user.csrf,source=origin)=>fetch(files+'?'+new URLSearchParams({name}),{method:'POST',
      headers:{cookie:user.cookie,origin:source,'Content-Type':'application/octet-stream','X-CSRF-Token':csrf},body:pdf});
    assert.equal((await fetch(files)).status,401);
    assert.equal((await uploadFile(pilot,'Beleg.pdf','')).status,403);
    assert.equal((await uploadFile(pilot,'Beleg.pdf',pilot.csrf,'https://foreign.example')).status,403);
    assert.equal((await uploadFile(pilot,'Beleg.html')).status,400);
    const created=await uploadFile(pilot,'Beleg März.pdf');
    assert.equal(created.status,201);
    const file=await created.json();
    assert.deepEqual(await (await fetch(files,{headers:{cookie:other.cookie}})).json(),[file]);
    assert.equal((await fetch(files+'/'+file.id)).status,401);
    const received=await fetch(files+'/'+file.id,{headers:{cookie:other.cookie}});
    assert.equal(received.headers.get('content-type'),'application/octet-stream');
    assert.match(received.headers.get('content-disposition'),/^attachment;/);
    assert.deepEqual(Buffer.from(await received.arrayBuffer()),pdf);
    const deleteFile=()=>fetch(files+'/'+file.id,{method:'DELETE',headers:{cookie:other.cookie,origin,
      'Content-Type':'application/json','X-CSRF-Token':other.csrf},body:'{}'});
    assert.equal((await deleteFile()).status,204);
    assert.equal((await deleteFile()).status,404);
    for(const extension of ['xls','xlsx','xlsm','xlsb']){
      const excel=await uploadFile(pilot,'Planung.'+extension);
      assert.equal(excel.status,201);
      const saved=await excel.json();
      const downloaded=await fetch(files+'/'+saved.id,{headers:{cookie:other.cookie}});
      assert.equal(downloaded.status,200);
      assert.match(downloaded.headers.get('content-disposition'),new RegExp('Planung\\.'+extension));
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),pdf);
    }
    assert.deepEqual(await (await putBoard(other,3,{...updated,cards:[]})).json(),{revision:4});
    assert.equal(db.prepare('SELECT count(*) AS total FROM task_board_attachment').get().total,0);
    const fibu=await fetch(origin+'/api/fibu/companies',{headers:{cookie:pilot.cookie}});
    assert.equal(fibu.status,200);
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});

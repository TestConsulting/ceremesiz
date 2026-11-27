const express=require('express');
const {requireAuthApi}=require('../middleware/auth');
const {requireCsrf,requireSameOriginJson}=require('../middleware/csrf');

const id=value=>typeof value==='string'&&/^[\w-]{1,64}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.length<=max;
const color=value=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value);
const picture=value=>value===undefined||value===''||typeof value==='string'&&value.length<=600000&&
  /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value);
const set=(items,max,valid)=>Array.isArray(items)&&items.length<=max&&items.every(x=>x&&id(x.id)&&valid(x))&&
  new Set(items.map(x=>x.id)).size===items.length;
const flag=value=>[undefined,false,true,0,1].includes(value);
function validate(b){
  if(!b||!set(b.cols,100,c=>text(c.n,180)&&flag(c.done))||!b.cols.length||
    !set(b.people,100,p=>text(p.n,180)&&color(p.c)&&picture(p.img))||
    !set(b.cos,100,c=>text(c.n,180)&&color(c.c)&&picture(c.img)))return false;
  const cols=new Set(b.cols.map(c=>c.id)), people=new Set(b.people.map(p=>p.id)), companies=new Set(b.cos.map(c=>c.id));
  return set(b.cards,2500,k=>cols.has(k.col)&&text(k.t,500)&&k.t.trim()&&text(k.d,20000)&&
    (k.co===''||companies.has(k.co))&&Array.isArray(k.who)&&k.who.every(w=>people.has(w))&&k.who.length<=people.size&&
    typeof k.due==='string'&&(!k.due||/^\d{4}-\d{2}-\d{2}$/.test(k.due))&&['hoch','mittel','niedrig'].includes(k.prio)&&
    flag(k.demo)&&Array.isArray(k.cl)&&k.cl.length<=200&&k.cl.every(c=>c&&text(c.t,1000)&&flag(c.ok)));
}
function createTaskBoard(db,allowedOrigins){
  db.exec('CREATE TABLE IF NOT EXISTS task_board (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT);INSERT OR IGNORE INTO task_board VALUES(1,0,NULL)');
  const row=db.prepare('SELECT revision,payload FROM task_board WHERE id=1');
  const read=()=>{const r=row.get();return {revision:r.revision,board:JSON.parse(r.payload)};};
  const write=db.prepare('UPDATE task_board SET revision=revision+1,payload=? WHERE id=1 AND revision=?');
  const router=express.Router();
  router.use(requireAuthApi,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/',(req,res)=>res.json(read()));
  router.put('/',requireSameOriginJson(allowedOrigins),requireCsrf,express.json({limit:'8mb'}),(req,res)=>{
    const {revision,board}=req.body||{};
    if(!Number.isSafeInteger(revision)||!validate(board))return res.status(400).json({error:'Ungültige Daten für das Aufgabenboard.'});
    if(!write.run(JSON.stringify(board),revision).changes)return res.status(409).json({error:'Das Board wurde inzwischen geändert.',...read()});
    res.json({revision:revision+1});
  });
  return {router,read};
}
module.exports=createTaskBoard;

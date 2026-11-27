const express=require('express');
const {randomUUID}=require('node:crypto');
const {requireAuthApi}=require('../middleware/auth');
const {requireCsrf,requireSameOriginJson,requireSameOrigin}=require('../middleware/csrf');

const fileTypes=new Set('pdf doc docx xls xlsx xlsm xlsb png jpg jpeg gif webp bmp tif tiff heic heif avif'.split(' '));
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
    flag(k.demo)&&[undefined,true,false].includes(k.completed)&&[undefined,true,false].includes(k.archived)&&Array.isArray(k.cl)&&k.cl.length<=200&&k.cl.every(c=>c&&text(c.t,1000)&&flag(c.ok)));
}
function createTaskBoard(db,allowedOrigins){
  db.exec('CREATE TABLE IF NOT EXISTS task_board (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT);INSERT OR IGNORE INTO task_board VALUES(1,0,NULL)');
  db.exec(`CREATE TABLE IF NOT EXISTS task_board_attachment (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, content BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS task_board_attachment_card ON task_board_attachment(card_id);`);
  const row=db.prepare('SELECT revision,payload FROM task_board WHERE id=1');
  const read=()=>{const r=row.get();return {revision:r.revision,board:JSON.parse(r.payload)};};
  const write=db.prepare('UPDATE task_board SET revision=revision+1,payload=? WHERE id=1 AND revision=?');
  const purge=db.prepare("DELETE FROM task_board_attachment WHERE card_id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?,'$.cards'))");
  const saveBoard=db.transaction((board,revision)=>{
    const payload=JSON.stringify(board);
    if(!write.run(payload,revision).changes)return false;
    purge.run(payload);
    return true;
  });
  const attachments=db.prepare('SELECT id,name,size FROM task_board_attachment WHERE card_id=? ORDER BY rowid');
  const count=db.prepare('SELECT count(*) AS total FROM task_board_attachment WHERE card_id=?');
  const download=db.prepare('SELECT name,content FROM task_board_attachment WHERE card_id=? AND id=?');
  const insert=db.prepare('INSERT INTO task_board_attachment VALUES(?,?,?,?,?)');
  const remove=db.prepare('DELETE FROM task_board_attachment WHERE card_id=? AND id=?');
  const cardExists=db.prepare("SELECT 1 FROM task_board, json_each(payload,'$.cards') WHERE task_board.id=1 AND json_extract(value,'$.id')=? LIMIT 1");
  const hasCard=cardId=>id(cardId)&&Boolean(cardExists.get(cardId));
  const requireCard=(req,res,next)=>hasCard(req.params.cardId)?next():res.status(404).json({error:'Karte nicht gefunden.'});
  const requireBinaryOrigin=requireSameOrigin(allowedOrigins,'application/octet-stream','Datei erforderlich.');
  const attachmentPath='/cards/:cardId/attachments';
  const router=express.Router();
  router.use(requireAuthApi,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/',(req,res)=>res.json(read()));
  router.put('/',requireSameOriginJson(allowedOrigins),requireCsrf,express.json({limit:'8mb'}),(req,res)=>{
    const {revision,board}=req.body||{};
    if(!Number.isSafeInteger(revision)||!validate(board))return res.status(400).json({error:'Ungültige Daten für das Aufgabenboard.'});
    if(!saveBoard(board,revision))return res.status(409).json({error:'Das Board wurde inzwischen geändert.',...read()});
    res.json({revision:revision+1});
  });
  router.get(attachmentPath,requireCard,(req,res)=>res.json(attachments.all(req.params.cardId)));
  router.post(attachmentPath,requireCard,requireBinaryOrigin,requireCsrf,
    express.raw({type:'application/octet-stream',limit:'10mb',inflate:false}),(req,res)=>{
      const name=typeof req.query.name==='string'?req.query.name.normalize('NFC').trim():'';
      if(!/^[^/\\\x00-\x1f\x7f]{1,180}$/u.test(name)||!fileTypes.has(name.split('.').pop().toLowerCase())||!name.includes('.'))
        return res.status(400).json({error:'Dateiname oder Dateiformat wird nicht unterstützt.'});
      if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Die Datei ist leer.'});
      // Während des asynchronen Einlesens kann die Karte gelöscht worden sein.
      if(!hasCard(req.params.cardId))return res.status(404).json({error:'Karte nicht gefunden.'});
      if(count.get(req.params.cardId).total>=20)return res.status(409).json({error:'Pro Karte sind bis zu 20 Anhänge möglich.'});
      const file={id:randomUUID(),name,size:req.body.length};
      insert.run(file.id,req.params.cardId,file.name,file.size,req.body);
      res.status(201).json(file);
    });
  router.get(attachmentPath+'/:fileId',requireCard,(req,res)=>{
    const file=download.get(req.params.cardId,req.params.fileId);
    if(!file)return res.status(404).json({error:'Anhang nicht gefunden.'});
    res.attachment(file.name).type('application/octet-stream').send(file.content);
  });
  router.delete(attachmentPath+'/:fileId',requireCard,requireSameOriginJson(allowedOrigins),requireCsrf,(req,res)=>{
    if(!remove.run(req.params.cardId,req.params.fileId).changes)return res.status(404).json({error:'Anhang nicht gefunden.'});
    res.sendStatus(204);
  });
  return {router,read};
}
module.exports=createTaskBoard;

const express = require('express');
const { requireAuthApi } = require('../middleware/auth');
const { requireCsrf, requireSameOriginJson } = require('../middleware/csrf');

const PDF = 'application/pdf';
const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const validDate = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
function requireValue(valid, message) {
  if (!valid) throw Object.assign(new Error(message), { status:400 });
}

module.exports = function salesRoutes({ db, allowedOrigins, access }) {
  const router = express.Router();
  const store = require('../sales/store')(db);
  const sources = require('../sales/sources')(db);
  const write = [requireSameOriginJson(allowedOrigins), requireCsrf, express.json({ limit: '15mb' })];
  router.use(requireAuthApi,(req,res,next) => {
    res.set('Cache-Control','no-store');
    req.salesAccess=access(req.user.email);
    if (!req.salesAccess.view) return res.status(403).json({error:'Kein Zugriff auf den Vertriebspilot.'});
    if (req.method==='POST' && !req.salesAccess.edit) return res.status(403).json({error:'Der Vertriebspilot ist für dieses Konto schreibgeschützt.'});
    next();
  });
  router.get('/sources', (req,res) => res.json({
    config:sources.getConfig(), definitions:sources.definitions, run:sources.recent()
  }));
  router.post('/sources',...write,(req,res) => {
    const b=req.body||{};
    requireValue(Array.isArray(b.sources)&&b.sources.every(key=>Object.hasOwn(sources.definitions,key)),'Unbekannte Quelle.');
    requireValue(Array.isArray(b.keywords)&&b.keywords.length<=30,'Maximal 30 Suchbegriffe eingeben.');
    requireValue(Array.isArray(b.times)&&b.times.length<=12&&b.times.every(t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t)),'Ungültige Suchzeiten.');
    res.json(sources.save({revision:b.revision,sources:[...new Set(b.sources)],
      keywords:[...new Set(b.keywords.map(k=>text(k,75)).filter(Boolean))],times:[...new Set(b.times)].sort()}));
  });
  router.post('/sources/check',...write,(req,res) => res.status(202).json({id:sources.start()}));
  router.get('/employees', (req,res) => res.json(store.listEmployees()));
  router.post('/employees',...write,(req,res) => {
    const b = req.body || {};
    const e = { name:text(b.name,150), role:text(b.role,150), available:text(b.available,10), bench:b.bench===true, eligible:b.eligible===true };
    requireValue(e.name && e.role && validDate(e.available),'Name, Rolle und gegebenenfalls gültige Verfügbarkeit eingeben.');
    res.json(store.saveEmployee(text(b.id,50),e));
  });
  router.post('/employees/:id/masters',...write,async(req,res) => {
    const b = req.body || {}, name = text(b.name,160);
    const content = Buffer.from(text(b.content,14_000_000),'base64');
    const type = name.toLowerCase().endsWith('.pdf') && content.subarray(0,5).toString()==='%PDF-' ? PDF :
      name.toLowerCase().endsWith('.docx') && content.subarray(0,4).equals(Buffer.from([80,75,3,4])) ? WORD : null;
    requireValue(type && content.length <= 10*1024*1024,'PDF oder Word-Datei (.docx) bis 10 MB angeben.');
    requireValue(Number.isSafeInteger(b.version) && b.version>=0,'Master-Version fehlt.');
    let evidence;
    try {
      const extracted = type===PDF ? (await require('../fibu/pdf').extract(content)).text :
        require('../sales/word-text')(content);
      evidence = text(extracted,100_000);
    } catch {
      requireValue(false,'Dokument konnte nicht gelesen werden.');
    }
    res.status(201).json(store.addMaster(req.params.id,{name,type,content,evidence},b.version,req.user.id));
  });
  router.get('/masters/:id/preview', (req,res) => {
    const m=store.master(req.params.id);
    res.json({type:m.type,evidence:m.evidence});
  });
  router.get('/masters/:id', (req,res) => {
    const m = store.master(req.params.id);
    if (m.type!==PDF || req.query.download==='1') res.attachment(m.name);
    res.type(m.type).send(m.content);
  });
  router.get('/employees/:id/history', (req,res) => res.json(store.history(req.params.id)));
  router.get('/cvs/:id', (req,res) => res.json(store.cv(req.params.id)));
  router.get('/cvs/:id/download/:format', async(req,res) => {
    const { format } = req.params;
    requireValue(['docx','pdf'].includes(format),'Unbekanntes Dokumentformat.');
    const c=store.cv(req.params.id), p=store.findProject(c.project), e=store.employee(c.employee);
    const name=(e.name+' - '+(p.reference||p.title)).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,140);
    const documents=require('../sales/documents');
    const bytes=await (format==='pdf'?documents.pdf(c.content):documents.word(c.content));
    res.attachment(name+'.'+format).type(format==='pdf'?PDF:WORD).send(bytes);
  });
  router.get('/projects', (req,res) => res.json(store.listProjects()));
  router.get('/projects/:id', (req,res) => res.json({
    project:store.findProject(req.params.id), suggestions:store.suggestions(req.params.id)
  }));
  router.post('/projects',...write,(req,res) => {
    const b=req.body || {};
    const limits={title:220,original:100_000,source:100,supplier:150,reference:200,originalLink:1000,messageId:500,
      contact:150,address:240,received:32,start:80,duration:80,utilization:80,location:150,model:100};
    const p=Object.fromEntries(Object.entries(limits).map(([name,max])=>[name,text(b[name],max)]));
    requireValue(p.title && p.original && p.source,'Titel, Originalausschreibung und Quelle sind erforderlich.');
    requireValue(!p.originalLink || /^https?:\/\/[^\s]+$/i.test(p.originalLink),'Original-Link muss mit HTTPS oder HTTP beginnen.');
    p.requirements=(Array.isArray(b.requirements)?b.requirements:[]).slice(0,80)
      .map(r=>({ text:text(r?.text,300), kind:['Muss','Kann'].includes(r?.kind)?r.kind:'Offen' })).filter(r=>r.text);
    const result=store.importProject(p);
    res.status(result.duplicate?200:201).json(result);
  });
  router.post('/projects/:id/offer',...write,(req,res) => {
    const b=req.body || {};
    requireValue(Array.isArray(b.candidates) && b.candidates.length<=25,'Ungültige Mitarbeiterauswahl.');
    const candidates=b.candidates.map(c=>{
      requireValue(c && typeof c==='object','Ungültige Mitarbeiterauswahl.');
      const rateCents=c.rateCents===null || c.rateCents===undefined ? null : c.rateCents;
      const start=text(c.start,10), content=text(c.content,100_000);
      requireValue(c.employee && c.master && content,'Mitarbeiter, Master-Version und CV-Inhalt angeben.');
      requireValue(validDate(start)&&(rateCents===null || Number.isSafeInteger(rateCents)&&rateCents>0),'Ungültiger Starttermin oder Stundensatz.');
      return {employee:text(c.employee,50),master:text(c.master,50),rateCents,start,content,terms:text(c.terms,2000)};
    });
    requireValue(new Set(candidates.map(c=>c.employee)).size===candidates.length,'Mitarbeiter nur einmal auswählen.');
    const offer={recipient:text(b.recipient,500),letter:text(b.letter,20_000),channel:text(b.channel,100),candidates};
    requireValue(offer.channel,'Versandkanal angeben.');
    res.json(store.saveOffer(req.params.id,b.revision,offer,req.user.id));
  });
  router.post('/projects/:id/move',...write,(req,res) => {
    const b=req.body||{};
    requireValue(['new','review'].includes(b.state),'Für Freigegeben den Freigabedialog nutzen.');
    res.json(store.move(req.params.id,b.revision,b.state));
  });
  router.post('/projects/:id/approve',...write,(req,res) => {
    if(!req.salesAccess.approve)return res.status(403).json({error:'Keine Freigabeberechtigung.'});
    const b=req.body||{};
    requireValue(b.confirm===true,'Diese Angebotsversion ausdrücklich bestätigen.');
    res.json(store.approve(req.params.id,b.revision,req.user.id));
  });
  router.post('/projects/:id/confirm-manual',...write,(req,res) => {
    const b=req.body||{},evidence=text(b.evidence,2000);
    requireValue(b.confirm===true && evidence,'Einreichung ausdrücklich bestätigen und Nachweis erfassen.');
    res.json(store.confirmManual(req.params.id,b.revision,req.user.id,evidence));
  });
  router.use((err,req,res,next) => {
    if (err.status>=400 && err.status<500) return res.status(err.status).json({error:err.status===413?'Anfrage ist zu groß.':err.message});
    next(err);
  });
  return router;
};

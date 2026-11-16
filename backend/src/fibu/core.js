const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const norm = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function fail(message, status = 422) { throw Object.assign(new Error(message), { status }); }
function monthFromFolder(folder) {
  if (typeof folder !== 'string' || folder.includes('\0')) fail('Monatsordner fehlt.', 400);
  const m = folder.replace(/[\\/]+$/, '').match(/(?:^|[\\/])(20\d{2})[\\/](0[1-9]|1[0-2])$/);
  if (!m) fail('Monatsordner muss auf Jahr/Monat enden, z. B. 2026/10.', 400);
  return `${m[1]}-${m[2]}`;
}
async function inside(root, input, kind = 'file') {
  if (typeof input !== 'string' || !input || input.includes('\0') || input.split(/[\\/]/).includes('..')) fail('Unerlaubter Pfad.', 400);
  const base = await fs.realpath(root);
  const candidate = path.isAbsolute(input) ? input : path.resolve(base, input);
  const real = await fs.realpath(candidate);
  const relative = path.relative(base, real);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('Pfad außerhalb der Firmenwurzel.', 403);
  const stat = await fs.stat(real);
  if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) fail('Dateityp passt nicht.');
  if (kind === 'file' && stat.size > 25 * 1024 * 1024) fail('Datei über 25 MB.');
  return real;
}
function classify(t, company) {
  const s = norm(t.description);
  const green = company.greenCounterparties || [];
  const partner=n=>norm(n).replace(/(?:gmbhundcokg|gmbhcokg|gmbh|ag)$/,'');
  // Green requires an identified counterparty; purpose mentions do not qualify.
  if (t.amount > 0 && green.some(n => partner(t.counterparty) === partner(n))) return { color: 'green', rule: 'Konfigurierte positive Gutschrift' };
  const fee = /sachbezugsabrechnung|kartengebu(?:e)?hr|kartenentgelt/.test(s)||(s.includes('paycenter')&&/abrechnung|gebu(?:e)?hr|entgelt/.test(s));
  if (company.payrollExceptions === true && t.amount < 0 && !fee &&
      (/ktolohn|vorschussu(?:e)?berweisung|steuerfreiesachleistung|sachbezugs?karten?aufladung/.test(s) || (s.includes('vorschuss')&&/u(?:e)?berweisung|dauerauftrag/.test(s)) ||
       (s.includes('dominiklapp') && s.includes('vwl')) ||
       (s.includes('tanerceremesiz') && /sachbezug.*aufladung/.test(s)))) {
    return { color: 'purple', rule: 'Betriebliche Nutzervorgabe: kein Beleg notwendig' };
  }
  return { color: null, rule: null };
}
function partyKey(value){const key=norm(value);if(/rciallemagne|rcibanque|mobilizefinancialservices/.test(key))return 'rcimobilize';if(/^cbrettschneidergmbh(?:kartonagenfabrik)?$/.test(key))return 'cbrettschneider';return key.replace(/^steuerberater/,'').replace(/(?:partnerschaftmbb|gmbhundcokg|gmbhcokg|gmbh|ag|se)$/,'');}
function referenceMatches(t,d){
 if(!d.invoice)return false;
 if(d.direction==='outgoing'){if(t.amount<=0||partyKey(t.counterparty)!==partyKey(d.customer))return false;}
 else if(d.invoice.length<5)return false;
 return new RegExp('(^|[^A-Z0-9])'+d.invoice.split('').map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[ \\t]*')+(d.layout==='remittance-advice'?'(?=Supplier\\b|[^A-Z0-9]|$)':'([^A-Z0-9]|$)'),'i').test(t.description);
}
function canonicalDocuments(docs){const seen=new Map(),result=[];for(const d of docs){const key=d.text?.normalize('NFKC').replace(/\s+/g,'');if(key&&seen.has(key)){d.duplicateOf=seen.get(key).id;continue;}if(key)seen.set(key,d);result.push(d);}return result;}
function match(t, docs) {
 const eligible=docs.filter(d=>d.verified&&!d.requiresReview&&d.amounts.length===1&&Math.abs(d.amounts[0]-Math.abs(t.amount))<.005&&(d.direction!=='outgoing'||t.amount>0)&&(!d.recurringPeriod||t.date>=d.recurringPeriod.from&&t.date<=d.recurringPeriod.to&&/miete|monatlich|dauerauftrag/i.test(t.description)));
 const exact=eligible.filter(d=>referenceMatches(t,d));if(exact.length)return exact;
 const corroborated=eligible.filter(d=>(d.referenceEvidence&&partyKey(d.supplier)===partyKey(t.counterparty)&&t.description.includes(d.referenceEvidence.reference)&&t.description.replace(/\s/g,'').includes(d.referenceEvidence.mandate))||(d.cardEvidence&&/KARTENZAHLUNG/.test(t.description)&&t.description.includes(d.cardEvidence.timestamp)));if(corroborated.length)return corroborated;
 const refs=(t.description.toUpperCase().match(/[A-Z0-9][A-Z0-9-]{5,}/g)||[]).filter(s=>/\d/.test(s));
 return eligible.filter(d=>d.direction!=='outgoing'&&(refs.some(r=>d.text.toUpperCase().includes(r))||(norm(t.counterparty).length>=5&&norm(d.supplier)===norm(t.counterparty))));
}
function allocations(txs,docs) {
  const groups=[];
  const references=referenceMatches;
  for(const d of docs.filter(d=>d.verified&&!d.requiresReview&&d.amounts.length===1)) {
    const ts=txs.filter(t=>references(t,d));
    if(ts.length>1&&ts.every(t=>Math.sign(t.amount)===Math.sign(ts[0].amount))&&Math.abs(ts.reduce((s,t)=>s+Math.abs(t.amount),0)-d.amounts[0])<.005)groups.push({transactions:ts,documents:[d]});
  }
  for(const t of txs) {
    const ds=docs.filter(d=>d.verified&&!d.requiresReview&&d.amounts.length===1&&references(t,d));
    if(ds.length>1&&Math.abs(ds.reduce((s,d)=>s+d.amounts[0],0)-Math.abs(t.amount))<.005)groups.push({transactions:[t],documents:ds});
  }
  return groups.filter(g=>!groups.some(other=>other!==g&&(other.transactions.some(t=>g.transactions.includes(t))||other.documents.some(d=>g.documents.includes(d)))));
}
const astraName = name => {const p=path.parse(path.basename(name)),stem=p.name.replace(/(?:_Astra)+/ig,'_Astra');return stem+(/_Astra(?:_|$)/i.test(stem)?'':'_Astra')+p.ext;};
async function writeVerified(folder, name, bytes) {
  // Exclusive create, never overwrite existing or follow an output symlink.
  const digest = hash(bytes), parsed = path.parse(path.basename(name));
  for (let n = 0; n < 100; n++) {
    const dest = path.join(folder, n ? `${parsed.name}_${digest.slice(0,12)}${n > 1 ? '_' + n : ''}${parsed.ext}` : parsed.base);
    try {
      await fs.writeFile(dest, bytes, { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const st = await fs.lstat(dest);
      if (st.isFile() && !st.isSymbolicLink() && hash(await fs.readFile(dest)) === digest) return dest;
      continue;
    }
    if (hash(await fs.readFile(dest)) !== digest) fail('Ablageprüfung fehlgeschlagen.');
    return dest;
  }
  fail('Zu viele Dateinamenskollisionen.');
}
module.exports = { hash, norm, fail, monthFromFolder, inside, classify, match, allocations, canonicalDocuments, partyKey, astraName, writeVerified };

const crypto = require('node:crypto');

const now = () => new Date().toISOString();
const json = JSON.stringify;
const parse = JSON.parse;
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

module.exports = function createSalesStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_employees (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
      available TEXT NOT NULL, bench INTEGER NOT NULL, eligible INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sales_masters (
      id TEXT PRIMARY KEY, employee TEXT NOT NULL REFERENCES sales_employees(id),
      version INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
      content BLOB NOT NULL, evidence TEXT NOT NULL, created TEXT NOT NULL,
      actor INTEGER NOT NULL, UNIQUE(employee, version)
    );
    CREATE TABLE IF NOT EXISTS sales_projects (
      id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
      revision INTEGER NOT NULL, state TEXT NOT NULL, offer TEXT,
      approval TEXT, shipment TEXT, imported TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sales_cvs (
      id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES sales_projects(id),
      employee TEXT NOT NULL REFERENCES sales_employees(id),
      master TEXT NOT NULL REFERENCES sales_masters(id), content TEXT NOT NULL,
      matching TEXT NOT NULL, created TEXT NOT NULL, actor INTEGER NOT NULL
    );
  `);
  const getEmployee = db.prepare('SELECT * FROM sales_employees WHERE id=?');
  const getProject = db.prepare('SELECT * FROM sales_projects WHERE id=?');
  const masterList = db.prepare('SELECT id, version, name, type, created FROM sales_masters WHERE employee=? ORDER BY version DESC');
  const getMaster = db.prepare('SELECT * FROM sales_masters WHERE id=?');
  const getCV = db.prepare('SELECT * FROM sales_cvs WHERE id=?');
  const latestMaster = db.prepare('SELECT id, version, evidence FROM sales_masters WHERE employee=? ORDER BY version DESC LIMIT 1');

  function employee(id) {
    return getEmployee.get(id) || fail('Mitarbeiter nicht gefunden.', 404);
  }
  function master(id) {
    return getMaster.get(id) || fail('Master-CV nicht gefunden.', 404);
  }
  function cv(id) {
    const row = getCV.get(id) || fail('Projekt-CV nicht gefunden.', 404);
    return { ...row, matching: parse(row.matching) };
  }
  function project(row) {
    return {
      id: row.id, ...parse(row.payload), imported: row.imported,
      revision: row.revision, state: row.state, offer: parse(row.offer),
      approval: parse(row.approval), shipment: parse(row.shipment)
    };
  }
  function findProject(id) {
    return project(getProject.get(id) || fail('Projekt nicht gefunden.', 404));
  }
  function editable(id, revision) {
    const value = findProject(id);
    if (value.revision !== revision) fail('Das Projekt wurde inzwischen geändert. Bitte neu laden.', 409);
    if (value.shipment) fail('Das eingereichte Angebot ist archiviert.', 409);
    return value;
  }
  function revise(id, state, offer, approval = null, shipment = null) {
    db.prepare('UPDATE sales_projects SET revision=revision+1,state=?,offer=?,approval=?,shipment=? WHERE id=?')
      .run(state, json(offer), json(approval), json(shipment), id);
    return findProject(id);
  }
  function matching(requirements, evidence) {
    const lines = evidence.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return requirements.map(requirement => {
      const term = new RegExp('(?<![\\p{L}\\p{N}])' + escaped(requirement.text) + '(?![\\p{L}\\p{N}])', 'iu');
      const location = lines.findIndex(line => term.test(line));
      return { ...requirement, evidence: location < 0 ? '' : lines[location], line: location < 0 ? null : location + 1,
        rating: location < 0 ? 'Offen' : 'Textnachweis · fachlich prüfen' };
    });
  }
  function suggestions(id) {
    const p = findProject(id);
    return db.prepare('SELECT id,name,role,available FROM sales_employees WHERE bench=1 AND eligible=1 ORDER BY name')
      .all().flatMap(e => {
        const m = latestMaster.get(e.id);
        return m ? [{ ...e, master: m.id, version: m.version, matching: matching(p.requirements, m.evidence) }] : [];
      });
  }
  return {
    employee, master, cv, findProject, suggestions,
    listEmployees: () => db.prepare('SELECT * FROM sales_employees ORDER BY name').all().map(e => ({ ...e, masters: masterList.all(e.id) })),
    history(id) {
      employee(id);
      return db.prepare(`SELECT c.id,c.created,m.version,p.payload FROM sales_cvs c
        JOIN sales_masters m ON m.id=c.master JOIN sales_projects p ON p.id=c.project
        WHERE c.employee=? ORDER BY c.created DESC,c.rowid DESC`).all(id).map(({payload,...row}) => {
        const p = parse(payload);
        return { ...row, title: p.title, reference: p.reference };
      });
    },
    saveEmployee(id, e) {
      if (id) {
        employee(id);
        db.prepare('UPDATE sales_employees SET name=?,role=?,available=?,bench=?,eligible=? WHERE id=?')
          .run(e.name,e.role,e.available,+e.bench,+e.eligible,id);
      } else {
        id = crypto.randomUUID();
        db.prepare('INSERT INTO sales_employees VALUES (?,?,?,?,?,?)')
          .run(id,e.name,e.role,e.available,+e.bench,+e.eligible);
      }
      return employee(id);
    },
    addMaster: db.transaction((id, file, expected, actor) => {
      employee(id);
      const current = latestMaster.get(id);
      if ((current?.version || 0) !== expected) fail('Master-Version hat sich geändert. Bitte neu laden.', 409);
      const key = crypto.randomUUID();
      db.prepare('INSERT INTO sales_masters VALUES (?,?,?,?,?,?,?,?,?)')
        .run(key,id,expected+1,file.name,file.type,file.content,file.evidence,now(),actor);
      return { id: key, version: expected+1 };
    }),
    listProjects: () => db.prepare('SELECT * FROM sales_projects ORDER BY imported DESC').all().map(project),
    importProject(p) {
      const normalized = value => value.trim().normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
      const reference = p.reference || p.originalLink || p.messageId;
      const stable = reference ? [p.source, p.supplier, reference] : [p.title, p.original];
      const identity = crypto.createHash('sha256').update(json(stable.map(normalized))).digest('hex');
      const id = crypto.randomUUID();
      const result = db.prepare("INSERT OR IGNORE INTO sales_projects VALUES (?,?,?,1,'new',NULL,NULL,NULL,?)")
        .run(id,identity,json(p),now());
      return { duplicate: !result.changes, project: project(db.prepare('SELECT * FROM sales_projects WHERE identity=?').get(identity)) };
    },
    saveOffer: db.transaction((id, revision, offer, actor) => {
      const p = editable(id, revision);
      const selected = offer.candidates.map(candidate => {
        const e = employee(candidate.employee);
        const m = master(candidate.master);
        if (m.employee !== e.id) fail('Master-Version gehört nicht zu diesem Mitarbeiter.');
        const previous = p.offer?.candidates.find(item => item.employee === e.id && item.cv);
        if ((!e.bench || !e.eligible) && !previous) fail('Mitarbeiter ist nicht für die Bench und den Vertrieb aktiv.');
        const existing = previous && cv(previous.cv);
        let docId = previous?.cv;
        if (!existing || existing.content !== candidate.content || existing.master !== m.id) {
          docId = crypto.randomUUID();
          db.prepare('INSERT INTO sales_cvs VALUES (?,?,?,?,?,?,?,?)')
            .run(docId,id,e.id,m.id,candidate.content,json(matching(p.requirements,m.evidence)),now(),actor);
        }
        const { content, ...terms } = candidate;
        return { ...terms, cv: docId, name: e.name, masterVersion: m.version };
      });
      return revise(id,'review',{ ...offer, candidates: selected });
    }),
    move: db.transaction((id, revision, state) => {
      const p = editable(id,revision);
      return revise(id,state,p.offer);
    }),
    approve: db.transaction((id, revision, actor) => {
      const p = editable(id,revision);
      const o = p.offer;
      if (p.approval) fail('Diese Angebotsversion ist bereits freigegeben.', 409);
      if (!o?.recipient || !o.letter || !o.candidates.length ||
          o.candidates.some(c => !c.rateCents || !c.start || !c.cv)) {
        fail('Empfänger, Anschreiben, CV, Stundensatz und verbindlichen Start ergänzen.');
      }
      const approval = { revision: p.revision+1, actor, date: now(), snapshot: o };
      return revise(id,'approved',o,approval);
    }),
    confirmManual: db.transaction((id, revision, actor, evidence) => {
      const p = editable(id,revision);
      if (p.approval?.revision !== p.revision) fail('Gültige Freigabe erforderlich.', 409);
      return revise(id,'approved',p.offer,p.approval,{
        channel: p.offer.channel, recipient:p.offer.recipient, date:now(), actor,
        evidence, documents:p.offer.candidates.map(c => c.cv), result:'Manuell eingereicht'
      });
    })
  };
};

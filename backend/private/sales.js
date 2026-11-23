/* global BOOT, esc, head, curRoute */
'use strict';

async function salesApi(route, body) {
  const response = await fetch('/api/sales'+route, body===undefined?{}:{
    method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':BOOT.csrfToken},
    body:JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error||'Anfrage fehlgeschlagen.');
  return data;
}

const salesField = (label,name,type='text',value='',required=false) =>
  '<label class="field">'+esc(label)+(type==='textarea'?
    '<textarea name="'+name+'" rows="5" '+(required?'required':'')+'>'+esc(value)+'</textarea>':
    '<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(required?'required':'')+'>')+'</label>';

const salesDocLinks = id => '<a href="/api/sales/cvs/'+id+'/download/docx">Word</a> · <a href="/api/sales/cvs/'+id+'/download/pdf">PDF</a>';
const salesButton = (text,selector) => '<button type="button" class="btn" '+selector+'>'+esc(text)+'</button>';

async function viewSales(page) {
  const route=curRoute, main=document.querySelector('#main');
  if (!BOOT.salesPilot) {
    main.innerHTML=head('tc','Vertrieb','Pilotzugriff erforderlich');
    return;
  }
  const title={employees:'Master Templates',projects:'Projekte/Freigaben',settings:'Vertriebskonfig'}[page];
  main.innerHTML=head('tc','Vertrieb',title)+'<div id="sales-error" role="alert"></div><div id="sales-body" class="sales-body"></div>'+
    '<style>.sales-body form{display:grid;gap:12px}.sales-body .field input,.sales-body textarea{width:100%;border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit}.sales-body .panel{margin-bottom:14px}.sales-body pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.sales-board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.sales-card{display:block;width:100%;text-align:left;margin:8px 0}.sales-cv-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.sales-body iframe{width:100%;min-height:400px;border:1px solid var(--line)}@media(max-width:800px){.sales-board,.sales-cv-grid{grid-template-columns:1fr}}</style>';
  const body=main.querySelector('#sales-body'), error=main.querySelector('#sales-error');
  const active=()=>curRoute===route && body.isConnected;
  const guard=fn=>async e=>{
    if(!active())return;
    error.textContent='';
    try { await fn(e); }
    catch(ex) { if(active())error.textContent=ex.message; }
  };
  const panel=(name,html)=>'<section class="panel"><h2>'+esc(name)+'</h2>'+html+'</section>';
  const bind=(id,fn)=>{const element=body.querySelector('#'+id);if(!element)return;if(!BOOT.salesEditor){element.disabled=true;return;}element.onclick=guard(fn);};
  const submit=(id,fn)=>{const form=body.querySelector('#'+id);if(!BOOT.salesEditor){form.querySelectorAll('input,textarea,button[type=submit]').forEach(field=>field.disabled=true);return;}form.onsubmit=guard(async e=>{
    e.preventDefault();
    if(!BOOT.salesEditor)throw new Error('Der Vertriebspilot ist für dieses Konto schreibgeschützt.');
    const button=e.currentTarget.querySelector('button[type=submit]');
    if(button)button.disabled=true;
    try{await fn(new FormData(e.currentTarget));}
    finally{if(button)button.disabled=false;}
  });};

  async function previewMaster(id,target) {
    const data=await salesApi('/masters/'+id+'/preview');
    if(!active()||!target.isConnected)return;
    target.innerHTML=data.type==='application/pdf'?
      '<iframe title="Master-CV" src="/api/sales/masters/'+id+'"></iframe>':
      '<p>Textvorschau · das Word-Original enthält die Formatierung.</p><pre>'+esc(data.evidence||'Kein auslesbarer Text verfügbar.')+'</pre>';
  }
  async function showEmployees() {
    const employees=await salesApi('/employees');
    if(!active())return;
    body.innerHTML=panel('Mitarbeiter',salesButton('Mitarbeiter anlegen','id="sales-new"')+
      employees.map(e=>'<p><b>'+esc(e.name)+'</b> · '+esc(e.role)+' · '+esc(e.available||'Start offen')+
        (e.bench&&e.eligible?' · Für Matching aktiv':'')+' '+salesButton('Öffnen','data-employee="'+e.id+'"')+'</p>').join(''))+
      '<div id="sales-detail"></div>';
    bind('sales-new',()=>employeeForm());
    body.querySelectorAll('[data-employee]').forEach(b=>b.onclick=guard(()=>employeeForm(employees.find(e=>e.id===b.dataset.employee))));
  }
  async function employeeForm(e={}) {
    const history=e.id?await salesApi('/employees/'+e.id+'/history'):[];
    if(!active())return;
    const d=body.querySelector('#sales-detail');
    d.innerHTML=panel(e.id?e.name:'Neuer Mitarbeiter','<form id="sales-employee">'+salesField('Name','name','text',e.name,true)+
      salesField('Rolle','role','text',e.role,true)+salesField('Verfügbar ab','available','date',e.available)+
      '<label><input name="bench" type="checkbox" '+(e.bench?'checked':'')+'> Auf der Bench</label>'+
      '<label><input name="eligible" type="checkbox" '+(e.eligible?'checked':'')+'> Im Vertrieb berücksichtigen</label>'+
      '<button class="btn primary" type="submit">Mitarbeiter speichern</button></form>')+
      (e.id?panel('Master-CV','<form id="sales-master"><label class="field">PDF oder Word (.docx)<input name="file" type="file" accept=".pdf,.docx" required></label>'+
        '<button class="btn" type="submit">'+(e.masters.length?'Neue Master-Version speichern':'Master speichern')+'</button></form>'+
        e.masters.map(m=>'<p>Version '+m.version+' · '+esc(m.name)+' · '+esc(m.created.slice(0,10))+' · '+
          salesButton('Master-CV ansehen','data-preview="'+m.id+'"')+
          ' · <a href="/api/sales/masters/'+m.id+'?download=1">Original herunterladen</a></p>').join('')+
        '<div id="sales-preview"></div>')+
        panel('Projekt-CV-Historie',history.map(h=>'<p><b>'+esc(h.title)+'</b> · '+esc(h.reference||'Referenz offen')+
          ' · '+h.created.slice(0,10)+' · Master '+h.version+' · '+salesDocLinks(h.id)+' '+salesButton('Vorschau','data-cv-preview="'+h.id+'"')+'</p>').join('')+'<div id="sales-cv-preview"></div>'):'');
    submit('sales-employee',async f=>{
      const saved=await salesApi('/employees',{...Object.fromEntries(f),id:e.id,bench:f.has('bench'),eligible:f.has('eligible')});
      const list=await salesApi('/employees');
      await employeeForm(list.find(item=>item.id===saved.id));
    });
    if(!e.id)return;
    submit('sales-master',async f=>{
      const file=f.get('file');
      if(file.size>10*1024*1024)throw new Error('Datei ist größer als 10 MB.');
      const data=await new Promise((resolve,reject)=>{
        const read=new FileReader();
        read.onload=()=>resolve(read.result.split(',')[1]);
        read.onerror=()=>reject(new Error('Datei konnte nicht gelesen werden.'));
        read.readAsDataURL(file);
      });
      await salesApi('/employees/'+e.id+'/masters',{ name:file.name,content:data,version:e.masters[0]?.version||0 });
      const list=await salesApi('/employees');
      await employeeForm(list.find(item=>item.id===e.id));
    });
    body.querySelectorAll('[data-preview]').forEach(b=>b.onclick=guard(()=>previewMaster(b.dataset.preview,body.querySelector('#sales-preview'))));
    body.querySelectorAll('[data-cv-preview]').forEach(b=>b.onclick=guard(async()=>{
      const doc=await salesApi('/cvs/'+b.dataset.cvPreview);
      if(active())body.querySelector('#sales-cv-preview').innerHTML='<pre>'+esc(doc.content)+'</pre>';
    }));
  }

  async function showProjects() {
    const projects=await salesApi('/projects');
    if(!active())return;
    body.innerHTML=salesButton('Ausschreibung erfassen','id="sales-import"')+
      '<div class="sales-board">'+Object.entries({new:'Neue Projekte',review:'Review',approved:'Freigegeben'})
        .map(([key,name])=>panel(name,projects.filter(p=>p.state===key).map(p=>
          '<button class="btn sales-card" data-project="'+p.id+'"><b>'+esc(p.title)+'</b><br>'+
          esc(p.source+' · '+(p.supplier||'Lieferant offen'))+'<br>'+esc((p.reference||'Referenz offen')+' · '+(p.start||'Start offen')+' · '+(p.model||'Einsatzmodell offen'))+'<br>'+
          esc(p.offer?.candidates.map(c=>c.name).join(', ')||'Auswahl offen')+
          (p.shipment?'<br>Manuell eingereicht':'')+'</button>').join(''))).join('')+'</div><div id="sales-detail"></div>';
    bind('sales-import',()=>{
      body.querySelector('#sales-detail').innerHTML=panel('Originalausschreibung erfassen','<form id="sales-project-form">'+
        salesField('Titel','title','text','',true)+salesField('Originalausschreibung','original','textarea','',true)+
        salesField('Quelle','source','text','',true)+salesField('Lieferant','supplier')+salesField('Referenz','reference')+
        salesField('Original-Link','originalLink','url')+salesField('E-Mail-Zuordnung','messageId')+salesField('Ansprechpartner','contact')+
        salesField('Kontaktadresse','address')+salesField('Eingang','received','date')+salesField('Starttermin','start')+
        salesField('Laufzeit','duration')+salesField('Auslastung','utilization')+salesField('Einsatzort','location')+
        salesField('Einsatzmodell','model')+salesField('Anforderungen, eine pro Zeile (optional Muss: oder Kann:)','requirements','textarea')+
        '<button type="submit" class="btn primary">Ausschreibung speichern</button></form>');
      submit('sales-project-form',async f=>{
        const input=Object.fromEntries(f);
        input.requirements=input.requirements.split(/\r?\n/).map(line=>{
          const match=/^(Muss|Kann):\s*(.*)$/i.exec(line.trim());
          return match?{kind:match[1].toLowerCase()==='muss'?'Muss':'Kann',text:match[2]}:{kind:'Offen',text:line};
        });
        const result=await salesApi('/projects',input);
        await showProjects();
        await showProject(result.project.id);
        if(result.duplicate)error.textContent='Diese Ausschreibung war bereits vorhanden.';
      });
    });
    body.querySelectorAll('[data-project]').forEach(b=>b.onclick=guard(()=>showProject(b.dataset.project)));
  }

  async function showProject(id) {
    const {project:p,suggestions}=await salesApi('/projects/'+id);
    const existing=await Promise.all((p.offer?.candidates||[]).map(async c=>({...c,doc:await salesApi('/cvs/'+c.cv)})));
    if(!active())return;
    const suggestionsById=new Map(suggestions.map(c=>[c.id,c]));
    const candidates=[...existing.map(c=>({...suggestionsById.get(c.employee),id:c.employee,name:c.name,master:c.master,
      matching:c.doc.matching,version:c.masterVersion,prior:c})),...suggestions.filter(c=>!existing.some(e=>e.employee===c.id))];
    const matching=m=>'<table class="kv"><thead><tr><th>Anforderung</th><th>Nachweis im Master</th><th>Bewertung</th></tr></thead><tbody>'+
      m.map(x=>'<tr><td>'+esc(x.kind+' · '+x.text)+'</td><td>'+esc(x.evidence?(x.evidence+' (Zeile '+x.line+')'):'Kein eindeutiger Nachweis')+
      '</td><td>'+esc(x.rating)+'</td></tr>').join('')+'</tbody></table>';
    const escInfo=v=>esc(v||'Offen');
    const metadata=[['Quelle',p.source],['Lieferant',p.supplier],['Referenz',p.reference],['E-Mail-Zuordnung',p.messageId],['Ansprechpartner',p.contact],
      ['Kontakt',p.address],['Eingang',p.received],['Import',p.imported],['Start',p.start],['Laufzeit',p.duration],['Auslastung',p.utilization],['Einsatzort',p.location],['Einsatzmodell',p.model]];
    const previousOffer=p.offer||{};
    const projectPath='/projects/'+id;
    const detail=body.querySelector('#sales-detail');
    detail.innerHTML=panel(p.title,metadata.map(([k,v])=>'<div><b>'+k+'</b> '+escInfo(v)+'</div>').join('')+
      (p.originalLink?'<p><a href="'+esc(p.originalLink)+'" rel="noopener noreferrer" target="_blank">Original öffnen</a></p>':'')+
      '<details open><summary>Originalausschreibung</summary><pre>'+esc(p.original)+'</pre></details>')+
      (p.shipment?panel('Versandstatus','<p>Manuell eingereicht · '+esc(p.shipment.channel)+' · '+esc(p.shipment.recipient)+' · '+esc(p.shipment.date)+'</p><pre>'+esc(p.shipment.evidence)+'</pre>'):'')+
      (p.approval?panel('Freigegebene Version','<p>Version '+p.approval.revision+' · '+esc(p.approval.date)+'</p><p>'+
        esc(previousOffer.channel)+' · '+esc(previousOffer.recipient)+'</p><pre>'+esc(previousOffer.letter)+'</pre>'+
        existing.map(c=>'<p>'+esc(c.name)+' · '+(c.rateCents/100).toFixed(2)+' EUR netto/h · '+esc(c.start)+' · '+salesDocLinks(c.cv)+'</p><pre>'+esc(c.terms)+'</pre>').join('')+
        (!p.shipment?'<p>Manueller Versand erforderlich. Verwende das freigegebene Anschreiben und die verlinkten CVs.</p>'+
        '<form id="sales-shipment">'+salesField('Nachweis der tatsächlichen Einreichung','evidence','textarea','',true)+
        '<label><input type="checkbox" name="confirm" required> Ich habe diese Version eingereicht und den Versand geprüft</label>'+
        '<button type="submit" class="btn">Einreichung dokumentieren</button></form>':'')):'')+
      (!p.shipment?panel('Angebot bearbeiten','<p>CV-Erstellung ist manuell. Belegte Angaben aus dem Master übernehmen und auf die Ausschreibung zuschneiden.</p>'+
        '<form id="sales-offer">'+salesField('Kanal','channel','text',previousOffer.channel||p.source,true)+
        salesField('Empfänger oder Zielportal','recipient','text',previousOffer.recipient||p.address)+
        salesField('Anschreiben','letter','textarea',previousOffer.letter)+candidates.map(c=>
          '<fieldset data-candidate="'+c.id+'"><legend>'+esc(c.name)+' · Master '+c.version+'</legend>'+
          '<label><input type="checkbox" name="selected-'+c.id+'" '+(c.prior?'checked':'')+'> Für dieses Angebot auswählen</label>'+
          matching(c.matching)+'<div class="sales-cv-grid"><div><a href="/api/sales/masters/'+c.master+'?download=1">Master-Original</a>'+
          salesButton('Master-Vorschau','data-master-preview="'+c.master+'"')+'<div data-master-frame="'+c.master+'"></div></div>'+
          salesField('Projekt-CV','cv-'+c.id,'textarea',c.prior?.doc.content||'')+'</div>'+
          (c.prior?salesDocLinks(c.prior.cv):'')+
          '<label class="field">EUR netto/h<input name="rate-'+c.id+'" type="number" min="0.01" step="0.01" value="'+(c.prior?.rateCents?c.prior.rateCents/100:'')+'"></label>'+
          salesField('Verbindlicher Start','start-'+c.id,'date',c.prior?.start)+salesField('Weitere Konditionen','terms-'+c.id,'text',c.prior?.terms)+'</fieldset>').join('')+
        '<button type="submit" class="btn primary">Angebot speichern · Review</button></form>'+
        '<div class="actions">'+salesButton('Neue Projekte','id="sales-move-new"')+salesButton('Review','id="sales-move-review"')+
        (!p.approval&&BOOT.salesApprover?salesButton('Freigabedialog öffnen','id="sales-open-approval"'):'')+'</div><div id="sales-approval-dialog"></div>'):'');
    const reload=async()=>{await showProjects();await showProject(id);};
    if(p.shipment)return;
    detail.querySelectorAll('[data-master-preview]').forEach(b=>b.onclick=guard(()=>
      previewMaster(b.dataset.masterPreview,detail.querySelector('[data-master-frame="'+b.dataset.masterPreview+'"]'))));
    submit('sales-offer',async f=>{
      const selected=candidates.filter(c=>f.has('selected-'+c.id)).map(c=>({
        employee:c.id,master:c.master,content:f.get('cv-'+c.id),
        rateCents:f.get('rate-'+c.id)?Math.round(Number(f.get('rate-'+c.id))*100):null,
        start:f.get('start-'+c.id),terms:f.get('terms-'+c.id)
      }));
      await salesApi(projectPath+'/offer',{revision:p.revision,recipient:f.get('recipient'),channel:f.get('channel'),letter:f.get('letter'),candidates:selected});
      await reload();
    });
    for(const state of ['new','review'])bind('sales-move-'+state,async()=>{
      await salesApi(projectPath+'/move',{revision:p.revision,state});await reload();
    });
    bind('sales-open-approval',()=>{
      if(!p.offer?.candidates.length)throw new Error('Zuerst die zu prüfende Angebotsversion speichern.');
      const target=detail.querySelector('#sales-approval-dialog');
      target.innerHTML='<dialog id="sales-approval-modal" class="panel"><h2>Angebotsversion '+p.revision+' freigeben</h2>'+
        '<p>'+esc(p.title)+' · '+esc(previousOffer.channel)+' · '+escInfo(previousOffer.recipient)+'</p><details><summary>Originalausschreibung</summary><pre>'+esc(p.original)+'</pre></details>'+
        '<pre>'+esc(previousOffer.letter)+'</pre>'+existing.map(c=>'<section><b>'+esc(c.name)+'</b><p>'+
          esc((c.rateCents?c.rateCents/100+' EUR netto/h':'Preis offen')+' · '+(c.start||'Start offen')+' · '+c.terms)+
          '</p>'+matching(c.doc.matching)+salesDocLinks(c.cv)+'<details><summary>Projekt-CV</summary><pre>'+esc(c.doc.content)+'</pre></details></section>').join('')+
        '<form id="sales-approve"><label><input type="checkbox" name="confirm" required> Ich gebe diese konkrete Angebotsversion frei</label>'+
        '<div role="alert" id="sales-approve-error"></div><button type="submit" class="btn primary">Freigeben</button></form>'+
        salesButton('Schließen','id="sales-close-approval"')+'</dialog>';
      const modal=target.querySelector('dialog');
      modal.showModal();
      bind('sales-close-approval',()=>modal.close());
      submit('sales-approve',async f=>{
        try{await salesApi(projectPath+'/approve',{revision:p.revision,confirm:f.has('confirm')});modal.close();await reload();}
        catch(e){target.querySelector('#sales-approve-error').textContent=e.message;}
      });
    });
    if(p.approval)submit('sales-shipment',async f=>{
      await salesApi(projectPath+'/confirm-manual',{revision:p.revision,confirm:f.has('confirm'),evidence:f.get('evidence')});await reload();
    });
  }

  async function showSettings() {
    const {config,definitions,credentialStorageReady,credentials}=await salesApi('/sources');
    if(!active())return;
    body.innerHTML=panel('Quellen und Suchvorgaben','<form id="sales-sources">'+
      Object.entries(definitions).map(([key,source])=>'<label><input type="checkbox" name="source" value="'+key+'" '+
        (config.sources.includes(key)?'checked':'')+'> '+esc(source.label)+' · <a href="'+esc(source.url)+'" target="_blank" rel="noopener noreferrer">Projektbörse öffnen</a></label>').join('')+
      salesField('Suchbegriffe, komma- oder zeilengetrennt','keywords','textarea',config.keywords.join(', '))+
      salesField('Geplante Zeiten, komma- oder zeilengetrennt','times','text',config.times.join(', '))+
      '<p>Zeitzone Europe/Berlin. Scheduler inaktiv, bis ein autorisierter automatischer Abruf verfügbar ist. Postfachimport ausgesetzt.</p>'+
      '<button type="submit" class="btn primary">Konfiguration speichern</button></form>')+
      panel('Portalzugänge',Object.entries(definitions).map(([key,source])=>{
        const account=credentials[key];
        const state=account.configured?'Zugang gespeichert · Anmeldung nicht automatisch geprüft':'Noch kein Zugang hinterlegt';
        return '<details class="panel"><summary><b>'+esc(source.label)+'</b> · '+state+'</summary>'+
          (BOOT.salesEditor&&credentialStorageReady?'<form id="sales-login-'+key+'">'+
            '<label class="field">Benutzername oder E-Mail<input name="username" type="text" autocomplete="username" maxlength="250" value="'+esc(account.username)+'" required></label>'+
            '<label class="field">Passwort<input name="password" type="password" autocomplete="new-password" maxlength="1000" '+(account.configured?'':'required')+'></label>'+
            (account.configured?'<p class="muted">Passwort leer lassen, um das gespeicherte Passwort zu behalten.</p>':'')+
            '<button class="btn primary" type="submit">Zugang speichern</button></form>':
            '<p>'+(BOOT.salesEditor?'Der Schlüssel für die verschlüsselte Speicherung fehlt.':'Zugänge können von berechtigten Konten bearbeitet werden.')+'</p>')+
          '<p><a href="'+esc(source.url)+'" target="_blank" rel="noopener noreferrer">Portal öffnen ↗</a></p></details>';
      }).join(''))+
      panel('Erreichbarkeit der Portale',salesButton('Quellen prüfen','id="sales-source-check"')+'<div id="sales-source-run" aria-live="polite"></div>');
    if(BOOT.salesEditor&&credentialStorageReady)for(const key of Object.keys(definitions)){
      submit('sales-login-'+key,async f=>{
        await salesApi('/sources/'+key+'/credentials',{username:f.get('username'),password:f.get('password'),version:credentials[key].version});
        await showSettings();
        const section=body.querySelector('#sales-login-'+key)?.closest('details');
        if(section)section.open=true;
      });
    }
    submit('sales-sources',async f=>{
      await salesApi('/sources',{revision:config.revision,sources:f.getAll('source'),
        keywords:f.get('keywords').split(/[,\n]/).map(x=>x.trim()).filter(Boolean),
        times:f.get('times').split(/[,\n]/).map(x=>x.trim()).filter(Boolean)});
      await showSettings();
    });
    async function refresh() {
      const {run}=await salesApi('/sources');
      const target=body.querySelector('#sales-source-run');
      if(!active()||!target)return;
      const button=body.querySelector('#sales-source-check');
      const running=run&&!run.finished&&Date.now()-new Date(run.started).getTime()<60000;
      button.disabled=!BOOT.salesEditor||Boolean(running);
      if(run) {
        const complete=run.sources.filter(s=>['manual','failed'].includes(s.state)).length;
        const labels={pending:'Offen',running:'In Arbeit',manual:'Manueller Schritt erforderlich',failed:'Fehlgeschlagen'};
        target.innerHTML='<p><progress aria-label="Fortschritt der Quellenprüfung" value="'+complete+'" max="'+run.sources.length+'"></progress> '+
          complete+' / '+run.sources.length+'</p>'+run.sources.map(s=>'<p><b>'+esc(definitions[s.key].label)+'</b> · '+
            esc(!running&&['pending','running'].includes(s.state)?'Unterbrochen':labels[s.state])+' '+esc(s.message)+'</p>').join('');
      }
      if(running)setTimeout(guard(refresh),1000);
    }
    bind('sales-source-check',async()=>{await salesApi('/sources/check',{});await refresh();});
    await refresh();
  }
  await guard(async()=>{
    if(page==='employees')return showEmployees();
    if(page==='projects')return showProjects();
    return showSettings();
  })();
}

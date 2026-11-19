/* Private, session-authenticated FIBU review. No document data in localStorage. */
let fibuTimer=null,fibuGeneration=0;
function fibuVerificationUrl(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!['microsoft.com','www.microsoft.com','login.microsoft.com','login.microsoftonline.com'].includes(u.hostname))throw Error('Unerwartetes Microsoft-Anmeldeziel.');return u.href;}
async function fibuApi(url,body) {
  const r=await fetch('/api/fibu'+url,{credentials:'same-origin',...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':BOOT.csrfToken},body:JSON.stringify(body)}:{})});
  const result=await r.json();if(!r.ok)throw Error(result.error||'Anfrage fehlgeschlagen');return result;
}
function fibuTime(s){return s?new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'medium',timeStyle:'short'}).format(new Date(s)):'–';}
function fibuLabel(s){return ({queued:'Wartet auf Ausführung',running:'Prüfung läuft',waiting_for_user:'Prüfung benötigt Klärung',completed:'Prüfung beendet',partial:'Teilweise geprüft',failed:'Prüfung fehlgeschlagen',cancelled:'Abgebrochen',missing:'Beleg fehlt',manual:'Manuelle Zuordnung',matched:'Beleg zugeordnet',not_required:'Kein Beleg notwendig'})[s]||s;}
function fibuMonth(s){return s.replace(/[\\/]+$/,'').match(/(?:^|[\\/])(20\d{2})[\\/](0[1-9]|1[0-2])$/)?.slice(1).join('-')||'Jahr/Monat noch nicht erkannt';}
function fibuProgress(job){
 const p=job?.workProgress;if(!p)return '';const active=['queued','running'].includes(job.state),percent=p.percent||0;
 const finished=!active&&percent===100&&['completed','partial','waiting_for_user'].includes(job.state);
 const completedAt=job.runFinishedAt||(finished?(job.events||[]).find(e=>e.message?.startsWith('Markierte PDF gespeichert und Text/Seitenzahl verifiziert'))?.at:null)||p.updatedAt;
 const elapsed=Math.max(0,((active?Date.now():Date.parse(completedAt))-Date.parse(p.startedAt))/1000);
 const duration=s=>s<60?Math.ceil(s)+' Sek.':Math.ceil(s/60)+' Min.';
 const remaining=percent>2&&elapsed>15?elapsed*(100-percent)/percent:null;
 const estimate=active?(remaining===null?'Restzeit wird ermittelt':'Restzeit grob '+duration(remaining*.7)+'–'+duration(remaining*1.5)+' · Schätzung, abhängig von OCR und Verbindung'):(percent===100?'Verarbeitung beendet':'Verarbeitung angehalten');
 return '<div class="f-job-progress" style="margin:12px 0"><div style="display:flex;justify-content:space-between;gap:12px"><strong>'+esc(finished?'Prüfung beendet':p.label)+(p.total&&!finished?' · '+p.done+'/'+p.total:'')+'</strong><span>'+percent+' %</span></div><progress aria-label="Fortschritt des Prüflaufs" max="100" value="'+percent+'" style="width:100%;height:12px;accent-color:#00853f"></progress><small style="display:block;margin-top:5px;color:#74828a">'+(finished?'Abgeschlossen · Dauer: '+duration(elapsed):estimate+' · Bisher '+duration(elapsed))+'</small></div>';
}
function fibuSearchScope(job){
 const scope=job.searchScope||{},legacy=!scope.folders,folders=scope.folders||[...new Set((job.cloudSources||[]).map(f=>f.path?.split('/').slice(0,-1).join('/')).filter(Boolean))].map(p=>({path:p,kind:p===job.sourceMonthPath||p.startsWith(job.sourceMonthPath+'/')?'selected':/\/20\d{2}\/(0[1-9]|1[0-2])(?:\/|$)/.test(p)?'previous':'collection',status:'loaded'}));
 const status={searched:'durchsucht',missing:'nicht vorhanden',error:'Fehler',reading:'wird geprüft',loaded:'Belege geladen'},kind={selected:'FiBu-Quelle',previous:'Vormonatsverzeichnis',collection:'zusätzliche Belegquelle'};
 return '<details class="panel" open><summary style="cursor:pointer;padding:12px"><strong>Suchbereich</strong></summary><div style="padding:0 16px 12px;font-size:12px;max-height:220px;overflow:auto"><p>E-Post: '+esc(scope.mailbox||(job.companyId==='tc'?'epost@testconsulting.de':'nicht protokolliert'))+' · '+esc(scope.mailFolder||'Posteingang')+(scope.historicalReferences?' · '+scope.historicalReferences.filter(r=>r.status==='searched').length+' postfachweite Referenzsuchen':' · zusätzliche Referenzsuche')+'</p><ul>'+folders.map(f=>'<li>OneDrive – '+esc(kind[f.kind]||'Verzeichnis')+': <span style="overflow-wrap:anywhere">'+esc((scope.driveRoot?scope.driveRoot+'/':'')+f.path)+'</span> · '+esc(status[f.status]||f.status)+'</li>').join('')+'</ul>'+(legacy?'<small>Älterer Lauf: angezeigt werden die Verzeichnisse mit protokollierten Quelldateien.</small>':'')+'</div></details>';
}
async function viewFibu(company,selectedMonth=null,selectedFolder=null,selectedName=null) {
  const generation=++fibuGeneration;clearTimeout(fibuTimer);
  $('#main').innerHTML=head(company,'Finanzbuchhaltung',esc(selectedName||'FiBu '+(selectedMonth?selectedMonth.slice(5)+'/'+selectedMonth.slice(0,4):'')),'<button class="btn" id="fibuBack">← FiBu-Monate</button>')+`<style>
    .fibu-form{display:grid;gap:12px;padding:20px}.fibu-form label{display:grid;gap:6px}.fibu-form input{width:100%;box-sizing:border-box;padding:10px}
    .fibu-review{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(350px,1fr);gap:16px}.fibu-review iframe{width:100%;height:640px;border:1px solid var(--line);order:0;border-radius:10px}.fibu-review #fibuRows{order:1;max-height:640px;overflow:auto}
    .fibu-row{padding:14px;border-bottom:1px solid var(--line);border-left:5px solid transparent}.fibu-row[data-color=green]{border-left-color:#39a85b}.fibu-row[data-color=yellow]{border-left-color:#d5b323}.fibu-row[data-color=purple]{border-left-color:#9d63bc}
    .fibu-row button,.fibu-row select{margin:5px}.fibu-status{padding:20px}.fibu-error{color:#ac2a2a} .fibu-legend{padding:16px;line-height:1.8}
    #fibuStart input,.fibu-status select,.fibu-row select{border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit;padding:9px}
    #fibuStatus button,.fibu-row button,#fibuConnection button,#fibuLogin button{border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit;padding:8px 12px;cursor:pointer}
    #fibuPlay{justify-self:start;width:auto;background:#00853f;color:white;border:0;padding:9px 15px;border-radius:6px;font:inherit;cursor:pointer}
    #fibuPlay:disabled{opacity:.5;cursor:wait}.fibu-status a{color:var(--c-tc,#00547f)}.fibu-row p{overflow-wrap:anywhere}
    .fibu-dialog{max-width:580px;width:calc(100% - 32px);border:1px solid var(--line);border-radius:13px;padding:27px;margin:auto;color:var(--ink)}.fibu-dialog::backdrop{background:#1c302c66;backdrop-filter:blur(3px)}.fibu-dialog h2{font-size:21px;margin:0 0 10px}.fibu-dialog label{display:grid;gap:7px;margin:17px 0;font-size:12px}.fibu-dialog select,.fibu-dialog textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:6px;font:inherit}.fibu-dialog button{padding:9px 13px;border:1px solid var(--line);border-radius:6px;background:white;cursor:pointer}.fibu-dialog .primary{background:#00853f;color:white;border-color:#00853f}
    @media(max-width:1000px){.fibu-review{grid-template-columns:1fr}}
    </style><details class="panel"><summary style="padding:16px;cursor:pointer">Prüfauftrag, Pfade &amp; Verbindung</summary><div class="fibu-status" id="fibuConnection">Konfiguration wird geladen …</div>
    <form id="fibuStart" class="fibu-form"><label>Monatsordner (auf dem Ausführungsrechner)<input name="folder" required placeholder="…\\2026\\10"></label>
    <label>Konkrete Original-Bank-PDF<input name="bank" required placeholder="Vollständiger Dateipfad"></label><p>Prüfmonat: <strong id="fibuMonth">–</strong></p>
    <button class="btn" id="fibuPlay" disabled>▶ Astra FIBU starten</button></form></details><p id="fibuError" role="alert" class="fibu-error"></p>
    <section class="panel fibu-legend">Grün: konfigurierte positive Gutschrift; ein Beleg kann weiterhin fehlen. Gelb: Beleg erfolgreich abgelegt.
    Lila: betriebliche Vorgabe „Kein Beleg notwendig“. Ohne Farbe: offen. Ein beendeter Lauf schließt den Monat nicht automatisch ab.</section>
    <section class="panel fibu-status"><label>Prüflauf <select id="fibuJobs"><option>Keine Läufe</option></select></label><div id="fibuStatus"></div></section><div id="fibuResult"></div><dialog id="fibuAssignDialog" class="fibu-dialog"></dialog>`;
  const error=e=>{if(generation===fibuGeneration)$('#fibuError').textContent=e.message;};
  $('#fibuBack').onclick=()=>viewFibuHome(company);
  const form=$('#fibuStart');form.folder.oninput=()=>$('#fibuMonth').textContent=fibuMonth(form.folder.value);
  let jobs=[],current=null,companyState=null;
  function draw(job) {
    current=job;form.folder.value=job.sourceMonthPath||job.monthFolderPath;form.bank.value=job.sourceBankName||job.bankPdfPath;$('#fibuMonth').textContent=job.month;
    const active=['queued','running'].includes(job.state),txs=job.transactions||[];
    $('#fibuPlay').disabled=active;
    $('#fibuStatus').innerHTML=`<p><strong>${esc(fibuLabel(job.state))}</strong> · ${esc(job.progress)}</p>${fibuProgress(job)}<p>Letzter Startversuch: ${fibuTime(job.created)} · Letzte erfolgreiche Dokumentprüfung: ${fibuTime(job.lastSuccessfulCheck)}</p>
      <p>${txs.filter(t=>t.status==='matched').length} zugeordnet · ${txs.filter(t=>t.status==='missing').length} Beleg fehlt · ${txs.filter(t=>t.status==='manual').length} manuell · ${txs.filter(t=>t.status==='not_required').length} kein Beleg notwendig</p>
      ${active?'<button id="fibuCancel">Lauf abbrechen</button>':'<button id="fibuClose">Monat abschließen</button> <button id="fibuReopen">Monat wieder öffnen</button>'}
      ${job.mailSummary?`<p class="fibu-status"><strong>E-Post:</strong> ${job.mailSummary.processed}/${job.mailSummary.messages} Nachrichten geprüft · ${job.mailSummary.marked} mit ASTRA/Erledigt markiert · ${job.mailSummary.failed} mit Ablage-/Verbindungsfehlern. Anhänge: ${job.mailSummary.stored} neu gespeichert, ${job.mailSummary.reused} wiederverwendet.</p>`:''}
      ${fibuSearchScope(job)}
      ${job.receiptPublication?`<p><strong>Belege im OneDrive-Zielordner:</strong> ${job.receiptPublication.files.length} verifiziert${job.receiptPublication.errors.length?' · '+job.receiptPublication.errors.length+' fehlgeschlagen':''}</p>`:''}
      ${job.issues?.length?`<ul>${job.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:''}`;
    const base='/api/fibu/jobs/'+encodeURIComponent(job.id)+'/files/';
    $('#fibuResult').innerHTML=`<section class="panel fibu-status"><a href="${base}original" target="_blank" rel="noopener">Originalbank öffnen</a>
      ${job.cloudPublished?.verified&&job.cloudPublished.webUrl?` · <a href="${esc(job.cloudPublished.webUrl)}" target="_blank" rel="noopener">Aktualisierte OneDrive-PDF ↗</a>`:''}
      ${job.markedPdfPath?` · <a href="${base}marked" target="_blank" rel="noopener">Markierte PDF öffnen</a>`:''}
      ${job.reportPath?` · <a href="${base}report" target="_blank" rel="noopener">Prüfbericht</a>`:''}
      <p><label>Filter <select id="fibuFilter"><option value="all">Alle Buchungen</option><option value="missing">Beleg fehlt (auch grün)</option><option value="manual">Manuelle Zuordnung</option><option value="matched">Beleg zugeordnet</option><option value="not_required">Kein Beleg notwendig</option></select></label></p></section>
      ${!active&&job.execution==='server'?'<p><button id="fibuPublishReceipts">Zugeordnete Belege im Zielordner ergänzen</button></p>':''}${!active?'<p><button id="fibuUnassigned">Nicht zugewiesene Belege einsortieren</button></p>':''}${job.unassignedReview?`<p>Nicht zugewiesene Belege: ${job.unassignedReview.count} · ${job.unassignedReview.webUrl?`<a href="${esc(job.unassignedReview.webUrl)}" target="_blank" rel="noopener">Ordner öffnen ↗</a>`:job.execution==='server'?'OneDrive-Ablage noch nicht vollständig':'Belege im FiBu-Ordner verschoben'}</p>`:''}<details class="panel fibu-status"><summary>Belege prüfen (${(job.documents||[]).filter(d=>(!d.verified&&!d.linkedVerification&&!d.crossVerified)||(d.requiresReview&&!d.crossVerified)).length} ungeklärt)</summary><div id="fibuDocuments">${(job.documents||[]).map(d=>`<p><a href="${base}${d.id}" target="_blank" rel="noopener">${esc(d.name)}</a> · ${esc(d.crossVerified?.evidence?.type==='confirmed_expense_reimbursement'?'Bestätigter Erstattungsbeleg zugeordnet':d.crossVerified?'OCR anhand Bankreferenzen gegengeprüft':d.linkedVerification?'Zahlungsnachweis mit Rechnung verknüpft':d.manualVerification?'Manuell bestätigt':d.requiresReview?'OCR prüfen':d.verified?'Firma erkannt':'Firma prüfen')} ${!active?`<button data-document-review="${d.id}">Am Original prüfen</button>`:''}</p>`).join('')}</div></details>
      <div class="fibu-review"><section class="panel" id="fibuRows"></section><iframe title="Bank-PDF" src="${base}${job.markedPdfPath?'marked':'original'}"></iframe></div>
      <details class="panel fibu-status"><summary>Prüfprotokoll</summary>${(job.events||[]).map(e=>`<p>${fibuTime(e.at)} – ${esc(e.message)}</p>`).join('')}</details>`;
    function rows(){const filter=$('#fibuFilter').value;$('#fibuRows').innerHTML=txs.filter(t=>filter==='all'||t.status===filter).map(t=>`<article class="fibu-row" data-color="${esc(t.color||'')}" data-id="${t.id}"><strong>${esc(t.date)} · ${new Intl.NumberFormat('de-DE',{style:'currency',currency:t.currency}).format(t.amount)}</strong><p>${esc(t.description)}</p><p>${esc(fibuLabel(t.status))} · ${esc(t.rule||t.reason||'Keine sichere Zuordnung')}</p>
      ${(t.receipts||[]).map(r=>`<p><a href="${base}${r.id}" target="_blank" rel="noopener">${esc(r.name)}</a>${r.oneDriveVerified?`<br><small>Im OneDrive-Zielordner: ${esc(r.oneDrivePath)}</small>`:''}</p>`).join('')}${!active?`<button data-assign>Beleg zuordnen</button>${t.receipts?.length?'<button data-undo>Aufheben</button>':''}`:''}</article>`).join('');}
    rows();$('#fibuFilter').onchange=rows;
    $('#fibuDocuments').onclick=e=>{
      const id=e.target.closest('[data-document-review]')?.dataset.documentReview;if(!id)return;
      const d=job.documents.find(d=>d.id===id),dialog=$('#fibuAssignDialog');
      dialog.innerHTML=`<h2>Beleg am Original prüfen</h2><p><a href="${base}${d.id}" target="_blank" rel="noopener">${esc(d.name)} öffnen ↗</a></p><p>Beleg, Bruttobetrag und Referenz am Original prüfen und die Firmenzuordnung bestätigen. Ein privater Empfänger kann mit dokumentierter Begründung zugeordnet werden. OCR liefert nur einen Vorschlag.</p>${d.ocr?`<details><summary>OCR-Text · Sicherheit ${Math.round(d.ocr.confidence)} %</summary><pre style="white-space:pre-wrap;max-height:160px;overflow:auto">${esc(d.ocr.text)}</pre></details>`:''}<form id="fibuDocumentForm"><label>Zugeordnete Firma<input name="companyName" value="${esc(companyState.documentCompanyName)}" readonly></label><label>Rechnungssteller<input name="supplier" required maxlength="200" value="${esc(d.supplier||'')}"></label><label>Rechnungsreferenz<input name="invoice" maxlength="100" value="${esc(d.invoice||'')}"></label><label>Bruttobetrag (EUR)<input name="amount" type="number" min="0.01" step="0.01" required value="${d.amounts?.length===1?d.amounts[0]:''}"></label><label>Rechnungsdatum<input name="invoiceDate" type="date"></label><label>Begründung<textarea name="reason" required minlength="5" maxlength="2000"></textarea></label><label style="display:block"><input name="confirmOriginal" type="checkbox" required> Beleg am Original geprüft und Firmenzuordnung bestätigt</label><p id="fibuDocumentError" role="alert"></p><button type="button" id="fibuDocumentCancel">Abbrechen</button> <button class="primary">Prüfung speichern</button></form>`;
      dialog.showModal();$('#fibuDocumentCancel').onclick=()=>dialog.close();
      const f=$('#fibuDocumentForm');f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button.primary');b.disabled=true;try{const next=await fibuApi('/jobs/'+job.id+'/documents/'+d.id+'/verify',{companyName:f.companyName.value,supplier:f.supplier.value,invoice:f.invoice.value,invoiceDate:f.invoiceDate.value,amount:Number(f.amount.value),currency:'EUR',reason:f.reason.value,confirmOriginal:f.confirmOriginal.checked});dialog.close();draw(next);if(['queued','running'].includes(next.state))fibuTimer=setTimeout(poll,1500);}catch(e){$('#fibuDocumentError').textContent=e.message;b.disabled=false;}};
    };
    $('#fibuRows').onclick=async e=>{
      const button=e.target.closest('button');if(!button)return;const row=button.closest('[data-id]');
      const undo=button.hasAttribute('data-undo'),transaction=job.transactions.find(t=>t.id===row.dataset.id),dialog=$('#fibuAssignDialog');
      dialog.innerHTML=`<h2>${undo?'Zuordnung aufheben':'Beleg zuordnen'}</h2><p>${esc(transaction.description)}</p><form id="fibuAssignForm">${undo?'<p>Der Beleg bleibt erhalten. Die Zuordnung und die markierte PDF werden aktualisiert.</p>':`<label>Verifizierter Beleg<select name="document" required><option value="">Beleg wählen</option>${(job.documents||[]).map(d=>`<option value="${d.id}" ${(!d.verified||d.requiresReview)?'disabled':''}>${esc(d.name)}${(!d.verified||d.requiresReview)?' – Firma/OCR klären':''}</option>`).join('')}</select></label>`}<label>Begründung<textarea name="reason" minlength="5" maxlength="2000" rows="3" required></textarea></label><p id="fibuAssignError" class="fibu-error" role="alert"></p><div style="display:flex;justify-content:flex-end;gap:9px"><button type="button" id="fibuAssignCancel">Abbrechen</button><button type="submit" class="primary">${undo?'Zuordnung aufheben':'Zuordnung speichern'}</button></div></form>`;
      dialog.showModal();$('#fibuAssignCancel').onclick=()=>dialog.close();
      const assignment=$('#fibuAssignForm');assignment.onsubmit=async e=>{e.preventDefault();const submit=assignment.querySelector('[type=submit]');submit.disabled=true;try{const next=await fibuApi('/jobs/'+job.id+'/assign',{transactionId:row.dataset.id,documentId:undo?null:assignment.elements.document.value,reason:assignment.reason.value});dialog.close();draw(next);if(['queued','running'].includes(next.state))fibuTimer=setTimeout(poll,1500);}catch(e){$('#fibuAssignError').textContent=e.message;submit.disabled=false;}};
    };
    if(!active&&job.execution==='server')$('#fibuPublishReceipts').onclick=async()=>{const b=$('#fibuPublishReceipts');b.disabled=true;try{await fibuApi('/jobs/'+job.id+'/receipts',{});draw(await fibuApi('/jobs/'+job.id));}catch(e){error(e);b.disabled=false;}};
    if(!active)$('#fibuUnassigned').onclick=async()=>{const b=$('#fibuUnassigned');b.disabled=true;try{await fibuApi('/jobs/'+job.id+'/unassigned',{});draw(await fibuApi('/jobs/'+job.id));}catch(e){error(e);b.disabled=false;}};
    if(active)$('#fibuCancel').onclick=async()=>{try{await fibuApi('/jobs/'+job.id+'/cancel',{});await poll();}catch(e){error(e);}};
    else for(const action of ['close','reopen'])$('#fibu'+(action==='close'?'Close':'Reopen')).onclick=async()=>{try{const result=await fibuApi('/jobs/'+job.id+'/month',{action});toast(result.closed?'Monat abgeschlossen':'Monat wieder geöffnet');}catch(e){error(e);}};
  }
  async function poll(){
    if(generation!==fibuGeneration||curRoute!=='fibu-'+company||!current)return;
    try{const j=await fibuApi('/jobs/'+current.id);if(generation!==fibuGeneration||curRoute!=='fibu-'+company)return;draw(j);if(['queued','running'].includes(j.state))fibuTimer=setTimeout(poll,1500);}catch(e){error(e);}
  }
  async function load(){jobs=(await fibuApi('/jobs?companyId='+company)).jobs.filter(j=>(!selectedMonth||j.month===selectedMonth)&&(!selectedFolder||(j.folderId||j.month)===selectedFolder));$('#fibuJobs').innerHTML=jobs.map(j=>`<option value="${j.id}">${esc(j.month)} · ${fibuTime(j.created)} · ${esc(fibuLabel(j.state))}</option>`).join('')||'<option>Keine Läufe</option>';if(jobs[0]){draw(jobs[0]);if(['queued','running'].includes(jobs[0].state))fibuTimer=setTimeout(poll,1500);}}
  form.onsubmit=async e=>{e.preventDefault();$('#fibuError').textContent='';$('#fibuPlay').disabled=true;try{const j=await fibuApi('/jobs',{companyId:company,folderId:selectedFolder||current?.folderId,month:current?.month||selectedMonth,monthFolderPath:form.folder.value,bankPdfPath:form.bank.value,bankDrivePath:current?.sourceBankIsDrivePath===true&&form.bank.value===current.sourceBankName});await load();draw(j);fibuTimer=setTimeout(poll,1000);}catch(e){error(e);$('#fibuPlay').disabled=false;}};
  $('#fibuJobs').onchange=()=>{const j=jobs.find(j=>j.id===$('#fibuJobs').value);if(j){clearTimeout(fibuTimer);draw(j);poll();}};
  try {
    const state=await fibuApi('/companies');if(generation!==fibuGeneration)return;
    const c=state.companies.find(c=>c.id===company);companyState=c;
    $('#fibuConnection').innerHTML=c?.enabled?`${state.mode==='cloud'?'Serverbetrieb · OneDrive direkt · unabhängig vom PC':state.mode==='remote'?'Gekoppelter Windows-Dienst · synchronisierter Firmenordner':'Lokaler Ausführungsmodus · synchronisierter Firmenordner'} · E-Post: ${c.connected?'verbunden':'nicht verbunden'}.
      ${c.microsoftConfigured?'<button id="fibuMicrosoft">Microsoft verbinden</button> <button id="fibuDisconnect">Verbindung trennen</button>':'Microsoft-App noch nicht eingerichtet.'}<div id="fibuLogin"></div>`:'Diese Firma ist noch nicht für den Pilotbetrieb konfiguriert. TestConsulting zuerst einrichten und abnehmen; anschließend weitere Firmen aktivieren.';
    if(!c?.enabled)return;$('#fibuPlay').disabled=false;await load();
    if(c.microsoftConfigured){$('#fibuDisconnect').onclick=async()=>{try{await fibuApi('/microsoft/'+company+'/disconnect',{});viewFibu(company);}catch(e){error(e);}};$('#fibuMicrosoft').onclick=async()=>{
      try{const login=await fibuApi('/microsoft/'+company+'/connect',{});
        // Only Microsoft's known sign-in destination is clickable.
        const uri=new URL(fibuVerificationUrl(login.verificationUri));
        $('#fibuLogin').innerHTML=`<p>Microsoft-Anmeldung: <a href="${esc(uri.href)}" target="_blank" rel="noopener">Anmeldeseite öffnen</a> · Code <strong>${esc(login.userCode)}</strong></p><button id="fibuPollLogin">Anmeldung prüfen</button>`;
        $('#fibuPollLogin').onclick=async()=>{try{const s=await fibuApi('/microsoft/'+company+'/poll',{});if(s.connected)viewFibu(company);else toast('Microsoft-Anmeldung noch nicht abgeschlossen.');}catch(e){error(e);}};
      }catch(e){error(e);}
    };}
  }catch(e){error(e);}
}

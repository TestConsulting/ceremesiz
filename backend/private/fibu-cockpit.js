/* Month overview follows the supplied Astra cockpit reference. */
async function viewFibuHome(company){
  const generation=++fibuGeneration;clearTimeout(fibuTimer);
  let state,c,jobs=[],months=[],contextMonth=null,browsePath='';
  const alive=()=>generation===fibuGeneration&&curRoute==='fibu-'+company;
  const name=month=>month.slice(5)+'/'+month.slice(0,4);
  const latest=month=>jobs.find(j=>j.month===month);
  const button=(action,label,primary=false,extra='')=>`<button type="button" data-fibu="${action}" ${primary?'class="primary"':''} ${extra}>${label}</button>`;
  const error=e=>{const el=document.getElementById('fibuHomeError');if(el)el.textContent=e.message;};
  function modal(content){const dialog=$('#fibuHomeModal');dialog.innerHTML=button('closeModal','×',false,'class="f-modal-close" aria-label="Dialog schließen"')+content;dialog.showModal();return dialog;}
  function render(){
    if(!alive())return;
    $('#main').innerHTML=`<link rel="stylesheet" href="/intern/fibu-cockpit.css"><div class="fibu-cockpit"><div class="f-head"><div><div class="f-kicker">${esc(CO[company].n)} · Finanzbuchhaltung</div><h1>Finanzbuchhaltung</h1></div><span class="f-badge">${state.demo?'Beispielansicht':'Privater Bereich'}</span></div>
      ${state.demo?'<div class="f-notice"><p>Beispielansicht · Ausschließlich synthetische Testdaten. Zuordnungen hier dienen nur zum Ausprobieren.</p></div>':''}
      ${c.pilotMode?'<div class="f-notice"><p>Pilotlauf mit Arbeitskopien · Originalordner bleiben erhalten. Outlook-Kategorien und Erledigt-Markierungen werden im Pilotmodus nicht verändert.</p></div>':''}
      ${state.mode==='remote'?`<div class="f-notice"><p>Windows-Verbindung: ${c.runnerOnline?'verbunden':'nicht erreichbar'}${c.runnerLastSeen?' · zuletzt '+fibuTime(c.runnerLastSeen):''}. ${c.runnerOnline?'Manuelle Prüfaufträge können ausgeführt werden.':'Neue Aufträge warten, bis der Rechner verbunden ist.'}</p></div>`:''}
      ${state.mode==='cloud'?'<div class="f-notice"><p>Serverbetrieb · OneDrive und E-Post werden direkt verbunden. Die Prüfung läuft auch bei ausgeschaltetem PC weiter.</p></div>':''}
      ${!c.enabled?'<div class="f-notice"><p>Diese Firma ist noch nicht für den Pilotbetrieb freigeschaltet. Zuerst TestConsulting einrichten und abnehmen.</p></div>':''}
      ${c.canConnect&&c.microsoftConfigured?`<div class="f-notice"><p>${c.connected?'Microsoft ist verbunden. Der Postfachzugriff kann separat geprüft werden.':'Verbinde dein berechtigtes Microsoft-Konto für E-Post.'}</p><div class="f-actions">${c.connected?button('probe','Postfachzugriff prüfen')+button('disconnect','Verbindung trennen'):button('connect','Microsoft verbinden',true)}</div></div>`:''}
      <div id="fibuHomeError" class="f-error" role="alert"></div><p>${button('sources','Belegquellen & Portalzugänge',false,c.enabled?'':'disabled')}</p><div class="f-titlebar"><div><h2>FiBu-Monate</h2><p>Monat öffnen, Kontoauszug prüfen und fehlende Belege zuordnen.</p></div>${button('new','+ Monat',true,c.enabled?'':'disabled')}</div>
      <div class="f-months">${months.map(m=>{
        const j=latest(m.month),tx=j?.transactions||[],matched=tx.filter(t=>t.status==='matched').length,done=tx.length&&matched===tx.length&&!j.issues.length;
        const success=jobs.find(j=>j.month===m.month&&j.lastSuccessfulCheck),active=['queued','running'].includes(j?.state);
        return `<article class="f-month" data-month="${m.month}"><div>${button('open','FiBu '+name(m.month),false,'class="f-month-name"')} ${state.demo?'<span class="f-badge">Beispiel</span>':''}<small>${esc(m.monthFolderPath)}</small></div><div><div class="f-count ${done?'done':''}">${tx.length?matched+'/'+tx.length+' zugeordnet'+(done?' ✓':''):'Noch nicht geprüft'}</div><small>Dokumente zuletzt geprüft: ${success?fibuTime(success.lastSuccessfulCheck):'Noch nicht geprüft'}</small><div class="f-bar ${done?'done':''}"><i style="width:${tx.length?matched/tx.length*100:0}%"></i></div></div>
          <div class="f-actions">${j?`<a class="f-link" href="/api/fibu/jobs/${j.id}/files/${j.markedPdfPath?'marked':'original'}" target="_blank" rel="noopener">▤ PDF</a>`:button('open','▤ PDF')}${button('folder','Ordner ↗')}${button('edit','FiBu-Pfad')}</div>
          <div class="f-agent"><div class="f-source"><span>KONTOAUSZUG · QUELLE FÜR ASTRA</span><p>${esc(m.bankPdfPath||'Noch kein Kontoauszug hinterlegt')}</p>${j?`<small>${esc(fibuLabel(j.state))} · Letzter Versuch: ${fibuTime(j.created)}</small>`:''}</div><div class="f-agent-actions">${button('edit','Kontoauszug-Pfad')}<span class="f-connection ${c.connected?'ok':''}">● ${c.connected?'E-Post verbunden':'E-Post nicht verbunden'}</span>${button('start',active?'◷ Prüfung läuft':'▶ Prüfung starten',true,active?'disabled':'')}</div></div></article>`;
      }).join('')||'<div class="f-empty">Noch kein FiBu-Monat angelegt. Hinterlege zuerst den Monatsordner und die konkrete Bank-PDF.</div>'}</div>
      <p class="f-hint">FiBu-Pfad = Belegordner · Kontoauszug-Pfad = konkrete Bank-PDF · ▶ = ausdrücklicher Startauftrag für Astra.</p><p class="f-hint">Änderungen an Monaten und Zuordnungen werden privat gespeichert. Ein beendeter Prüflauf ist noch kein Monatsabschluss.</p><dialog id="fibuHomeModal"></dialog></div>`;
    $('#main .fibu-cockpit').onclick=click;
  }
  async function refresh(){
    if(document.getElementById('fibuHomeModal')?.open){clearTimeout(fibuTimer);fibuTimer=setTimeout(()=>refresh().catch(error),1500);return;}
    const [j,m]=await Promise.all([fibuApi('/jobs?companyId='+company),fibuApi('/months?companyId='+company)]);if(!alive())return;jobs=j.jobs;
    const map=new Map(m.months.map(m=>[m.month,m]));for(const j of jobs)if(!map.has(j.month))map.set(j.month,{companyId:company,month:j.month,monthFolderPath:j.sourceMonthPath||j.monthFolderPath,bankPdfPath:j.sourceBankName||j.bankPdfPath,folderUrl:''});
    months=[...map.values()].sort((a,b)=>b.month.localeCompare(a.month));render();clearTimeout(fibuTimer);if(jobs.some(j=>['queued','running'].includes(j.state)))fibuTimer=setTimeout(()=>refresh().catch(error),1500);
  }
  function edit(m){
    if(state.mode==='cloud'){browse(m?.monthFolderPath||c.cloudMonthBase||'').catch(error);return;}
    modal(`<h2>${m?'FiBu-Pfade ändern':'FiBu-Monat anlegen'}</h2><p>${esc(CO[company].n)} · Der Prüfmonat wird aus dem Monatsordner abgeleitet.</p><form id="fibuMonthForm"><label>FiBu-Ordnerpfad<input name="folder" required maxlength="2000" value="${esc(m?.monthFolderPath||'')}" placeholder="…\\2026\\10"></label><label>Konkrete Original-Bank-PDF<input name="bank" maxlength="2000" value="${esc(m?.bankPdfPath||'')}" placeholder="Vollständiger Dateipfad"></label><label>OneDrive-Ordnerlink (optional)<input name="url" type="url" value="${esc(m?.folderUrl||'')}" placeholder="https://…"></label><p>Abgeleiteter Prüfmonat: <strong id="fibuDerivedMonth">${m?name(m.month):'Noch nicht erkannt'}</strong></p><div id="fibuModalError" class="f-error" role="alert"></div><div class="f-dialogfoot"><button type="submit" class="primary">Monat speichern</button></div></form>`);
    const f=$('#fibuMonthForm');f.folder.oninput=()=>{const month=fibuMonth(f.folder.value);$('#fibuDerivedMonth').textContent=/^20\d{2}-\d{2}$/.test(month)?name(month):'Noch nicht erkannt';};
    f.onsubmit=async e=>{e.preventDefault();try{await fibuApi('/months',{companyId:company,monthFolderPath:f.folder.value,bankPdfPath:f.bank.value,folderUrl:f.url.value});$('#fibuHomeModal').close();await refresh();toast('FiBu-Monat gespeichert');}catch(e){$('#fibuModalError').textContent=e.message;}};
  }
  async function browse(relative){
    const data=await fibuApi('/onedrive/'+company+'?path='+encodeURIComponent(relative));browsePath=data.path;
    const month=fibuMonth(browsePath),valid=/^20\d{2}-\d{2}$/.test(month);
    modal(`<h2>OneDrive-Monatsordner wählen</h2><p>${esc(browsePath||'Firmenordner')}</p>${browsePath?button('driveUp','↑ Übergeordneter Ordner'):''}<div>${data.entries.filter(d=>d.folder).map(d=>button('driveFolder',esc(d.name),false,'data-path="'+esc((browsePath?browsePath+'/':'')+d.name)+'"')).join(' ')}</div><form id="fibuCloudMonth"><p>Prüfmonat: ${valid?esc(name(month)):'Bitte Jahr/Monat öffnen'}</p><label>Original-Kontoauszug<select name="bank" required><option value="">PDF auswählen</option>${data.entries.filter(d=>d.file&&/\.pdf$/i.test(d.name)&&!/_Astra(?:_|\.)/i.test(d.name)).map(d=>`<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}</select></label><p id="fibuCloudError" class="f-error" role="alert"></p><button class="primary" ${valid?'':'disabled'}>Monat speichern</button></form>`);
    const f=$('#fibuCloudMonth');f.onsubmit=async e=>{e.preventDefault();try{await fibuApi('/months',{companyId:company,monthFolderPath:browsePath,bankPdfPath:f.bank.value});$('#fibuHomeModal').close();await refresh();toast('OneDrive-Monat gespeichert');}catch(e){$('#fibuCloudError').textContent=e.message;}};
  }
  async function click(e){
    const b=e.target.closest('[data-fibu]');if(!b)return;const action=b.dataset.fibu,month=b.closest('[data-month]')?.dataset.month||contextMonth,m=months.find(m=>m.month===month);contextMonth=month;
    try{
      if(action==='driveFolder'){await browse(b.dataset.path);return;}
      if(action==='driveUp'){await browse(browsePath.split('/').slice(0,-1).join('/'));return;}
      if(action==='sources'){
        const data=await fibuApi('/sources/'+company);
        modal(`<h2>Belegquellen &amp; Portalzugänge</h2><p>E-Post: ${c.connected?'verbunden':'nicht verbunden'} · Firmenordner: ${state.mode==='cloud'?'OneDrive direkt auf dem Server':'synchronisierter Windows-Ordner'}.</p><p>Lieferantenportale sind für eine spätere Erweiterung vorgemerkt. Es wird aktuell kein Portal automatisch geprüft.</p><table style="width:100%;text-align:left"><thead><tr><th>Quelle</th><th>Status</th></tr></thead><tbody>${data.sources.map(s=>`<tr><td>${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>`:esc(s.name)}</td><td>Vorgemerkt · ${s.url?'Adresse hinterlegt':'Adresse fehlt'} · Anmeldung ungeprüft</td></tr>`).join('')}</tbody></table><h3>Heruntergeladenen Beleg importieren</h3><p>PDF oder Bild in den Sammelordner übernehmen. Der Import bestätigt noch keine Firma oder Zuordnung und startet keinen Prüflauf.</p><form id="fibuImportForm"><label>Quelle<select name="source">${data.sources.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><label>Datei<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required></label><p id="fibuImportStatus" role="status"></p><button class="primary">Beleg importieren</button></form>`);
        const f=$('#fibuImportForm');f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;try{const file=f.file.files[0];if(!file||file.size>25*1024*1024)throw Error('Datei bis 25 MB wählen.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Datei nicht lesbar.'));reader.readAsDataURL(file);});await fibuApi('/imports/'+company,{source:f.source.value,name:file.name,data});$('#fibuImportStatus').textContent='Beleg gespeichert. Beim nächsten ausdrücklichen Prüflauf werden Firma und Zuordnung geprüft.';f.file.value='';}catch(e){$('#fibuImportStatus').textContent=e.message;}finally{b.disabled=false;}};return;
      }
      if(action==='connect'){
        const login=await fibuApi('/microsoft/'+company+'/connect',{}),uri=new URL(fibuVerificationUrl(login.verificationUri));
        modal(`<h2>Microsoft verbinden</h2><p>Öffne die Microsoft-Anmeldung und bestätige dort den angezeigten Code.</p><div class="f-path"><strong>${esc(login.userCode)}</strong></div><div class="f-dialogfoot"><a class="f-link" href="${esc(uri.href)}" target="_blank" rel="noopener">Microsoft-Anmeldung öffnen ↗</a>${button('pollLogin','Anmeldung prüfen',true)}</div><p id="fibuLoginStatus" role="status"></p>`);return;
      }
      if(action==='pollLogin'){
        const result=await fibuApi('/microsoft/'+company+'/poll',{});
        if(!result.connected){$('#fibuLoginStatus').textContent='Microsoft-Anmeldung noch nicht abgeschlossen.';return;}
        state=await fibuApi('/companies');c=state.companies.find(c=>c.id===company);render();toast('Microsoft-Anmeldung erfolgreich');return;
      }
      if(action==='probe'){
        b.disabled=true;try{const result=await fibuApi('/microsoft/'+company+'/probe',{});modal(`<h2>Postfachzugriff bestätigt</h2><p>Angemeldet als ${esc(result.user.email)}.</p><div class="f-path"><strong>${esc(result.mailbox)}</strong><p>Posteingang erreichbar · ${esc(result.inbox.itemCount)} Nachrichten</p></div><p>Geprüft: ${fibuTime(result.checkedAt)}. Es wurden keine Nachrichten oder Kategorien verändert.</p>`);}finally{b.disabled=false;}return;
      }
      if(action==='disconnect'){await fibuApi('/microsoft/'+company+'/disconnect',{});state=await fibuApi('/companies');c=state.companies.find(c=>c.id===company);render();return;}
      if(action==='closeModal'){$('#fibuHomeModal').close();return;}
      if(action==='new'){edit(null);return;}
      if(action==='edit'){edit(m);return;}
      if(action==='open'){if(latest(month))viewFibu(company,month);else edit(m);return;}
      if(action==='folder'&&state.mode==='cloud'){await browse(m.monthFolderPath);return;}if(action==='folder'){modal(`<h2>FiBu-Ordner</h2><div class="f-path">${esc(m.monthFolderPath)}</div><p>Der Ordner liegt auf dem verbundenen Rechner. Ein hinterlegter OneDrive-Weblink öffnet ihn im Browser.</p>${m.folderUrl?`<a class="f-link" href="${esc(m.folderUrl)}" target="_blank" rel="noopener">Ordner öffnen ↗</a>`:button('edit','Ordnerlink hinterlegen')}`);return;}
      if(action==='start'){
        if(!m.bankPdfPath){edit(m);return;}
        modal(`<h2>Astra FIBU starten</h2><p>Du beauftragst die Prüfung dieser Firma und dieses Monats. Der Originalauszug bleibt erhalten.</p><div class="f-path"><b>${esc(CO[company].n)} · ${name(month)}</b><p>Belegordner: ${esc(m.monthFolderPath)}</p><p>Kontoauszug: ${esc(m.bankPdfPath)}</p></div><p>Belege sammeln, mit Bankbuchungen abgleichen und eine markierte Kopie speichern. Unklare Zuordnungen bleiben offen.</p><div id="fibuModalError" class="f-error" role="alert"></div><div class="f-dialogfoot">${button('closeModal','Abbrechen')}${button('confirmStart','▶ Prüfung starten',true)}</div>`);return;
      }
      if(action==='confirmStart'){b.disabled=true;try{await fibuApi('/jobs',{companyId:company,monthFolderPath:m.monthFolderPath,bankPdfPath:m.bankPdfPath});viewFibu(company,month);}catch(e){$('#fibuModalError').textContent=e.message;b.disabled=false;}return;}
    }catch(e){error(e);}
  }
  $('#main').innerHTML='<p>FiBu-Monate werden geladen …</p>';
  try{state=await fibuApi('/companies');if(!alive())return;c=state.companies.find(c=>c.id===company);if(c?.enabled)await refresh();else render();}catch(e){$('#main').innerHTML='<p class="f-error">'+esc(e.message)+'</p>';}
}

/* Month overview follows the supplied Astra cockpit reference. */
async function viewFibuHome(company){
  const generation=++fibuGeneration;clearTimeout(fibuTimer);
  let state,c,jobs=[],months=[],contextEntry=null,savedNotice='',removedEntries=[],lastRemoved=null,browsePath='',pickerMode='new',pickerMonth=null,selectedBank='',driveEntries=[],browseGeneration=0,pickerPeriod='',pickerLabel='',pickerNameEdited=false;
  const alive=()=>generation===fibuGeneration&&curRoute==='fibu-'+company;
  const name=month=>month.slice(5)+'/'+month.slice(0,4);
  const entryName=m=>m.name||'FiBu '+name(m.month)+(m.label?' · '+m.label:'');
  const belongs=(j,m)=>{
    if((j.folderId||j.month)!==m.id||j.month!==m.month||(j.sourceMonthPath??j.monthFolderPath)!==m.monthFolderPath)return false;
    if(state.mode!=='cloud')return (j.sourceBankName||j.bankPdfPath)===m.bankPdfPath;
    const source=j.sourceBankName||j.bankPdfPath,bank=m.bankPdfPath;
    const full=(p,absolute)=>absolute||p.includes('/')?p:(m.monthFolderPath?m.monthFolderPath+'/':'')+p;
    return full(source,j.sourceBankIsDrivePath)===full(bank,m.bankDrivePath);
  };
  const latest=m=>jobs.find(j=>belongs(j,m));
  const button=(action,label,primary=false,extra='')=>`<button type="button" data-fibu="${action}" ${primary?'class="primary"':''} ${extra}>${label}</button>`;
  const error=e=>{const el=document.getElementById('fibuHomeModal')?.open?document.getElementById('fibuDialogError'):document.getElementById('fibuHomeError');if(el)el.textContent=e.message;};
  function modal(content){const dialog=$('#fibuHomeModal');dialog.innerHTML=button('closeModal','×',false,'class="f-modal-close" aria-label="Dialog schließen"')+content+'<p id="fibuDialogError" class="f-error" role="alert"></p>';dialog.showModal();return dialog;}
  function render(){
    if(!alive())return;
    $('#main').innerHTML=`<link rel="stylesheet" href="/intern/fibu-cockpit.css"><div class="fibu-cockpit"><div class="f-head"><div><div class="f-kicker">${esc(CO[company].n)} · Finanzbuchhaltung</div><h1>Finanzbuchhaltung</h1></div><span class="f-badge">${state.demo?'Beispielansicht':'Privater Bereich'}</span></div>
      ${state.demo?'<div class="f-notice"><p>Beispielansicht · Ausschließlich synthetische Testdaten. Zuordnungen hier dienen nur zum Ausprobieren.</p></div>':''}
      ${!c.enabled?'<div class="f-notice"><p>Diese Firma ist noch nicht für den Pilotbetrieb freigeschaltet. Zuerst TestConsulting einrichten und abnehmen.</p></div>':''}
      ${savedNotice||lastRemoved?`<p role="status" class="f-saved">${esc(savedNotice)} ${lastRemoved?button('undoRemove','Entfernten Eintrag wiederherstellen'): ''}</p>`:''}<div id="fibuHomeError" class="f-error" role="alert"></div><div class="f-titlebar"><div><div class="f-section-title"><h2>FiBu-Monate</h2>${button('info','ⓘ',false,'aria-label="Job-Einstellungen und Regeln" title="Job-Einstellungen und Regeln"')}<span class="f-connection ${c.connected?'ok':''}">● ${c.connected?'Microsoft verbunden':'Microsoft nicht verbunden'}</span></div><p>Monat öffnen, Kontoauszug prüfen und fehlende Belege zuordnen.</p></div>${button('new','+ Monat',true,c.enabled?'':'disabled')}</div>
      <div class="f-months">${months.map(m=>{
        const j=latest(m),tx=j?.transactions||[],matched=tx.filter(t=>t.status==='matched').length,done=tx.length&&matched===tx.length&&!j.issues.length;
        const success=jobs.find(j=>belongs(j,m)&&j.lastSuccessfulCheck),active=['queued','running'].includes(j?.state);
        return `<article class="f-month" data-month="${m.month}" data-entry-id="${esc(m.id)}"><div>${button('open',esc(entryName(m)),false,'class="f-month-name"')} ${button('rename','✎',false,'aria-label="Name bearbeiten" title="Name bearbeiten"')} ${button('remove','Entfernen',false,'aria-label="Eintrag entfernen"')} ${state.demo?'<span class="f-badge">Beispiel</span>':''}<small>${esc(m.monthFolderPath)}</small></div><div><div class="f-count ${done?'done':''}">${tx.length?matched+'/'+tx.length+' zugeordnet'+(done?' ✓':''):'Noch nicht geprüft'}</div><small>Dokumente zuletzt geprüft: ${success?fibuTime(success.lastSuccessfulCheck):'Noch nicht geprüft'}</small><div class="f-bar ${done?'done':''}"><i style="width:${tx.length?matched/tx.length*100:0}%"></i></div></div>
          <div class="f-actions">${j?`<a class="f-link" href="/api/fibu/jobs/${j.id}/files/${j.markedPdfPath?'marked':'original'}" target="_blank" rel="noopener">▤ PDF</a>`:button('open','▤ PDF')}${button('folder','Ordner ↗')}${button('edit','FiBu-Pfad')}</div>
          <div class="f-agent"><div class="f-source"><span>KONTOAUSZUG · QUELLE FÜR ASTRA</span><p>${esc(m.bankPdfPath||'Noch kein Kontoauszug hinterlegt')}</p>${j?fibuProgress(j):''}${j?`<small>${esc(fibuLabel(j.state))} · Letzter Versuch: ${fibuTime(j.created)}</small>`:''}</div><div class="f-agent-actions">${button('bank','Kontoauszug-Pfad')}<span class="f-connection ${c.connected?'ok':''}">● ${c.connected?'E-Post verbunden':'E-Post nicht verbunden'}</span>${button('start',active?'◷ Prüfung läuft':'▶ Prüfung starten',true,active?'disabled':'')}</div></div></article>`;
      }).join('')||'<div class="f-empty">Noch kein FiBu-Monat angelegt. Hinterlege zuerst den Monatsordner und die konkrete Bank-PDF.</div>'}</div>
      <p class="f-hint">FiBu-Pfad = Belegordner · Kontoauszug-Pfad = konkrete Bank-PDF · ▶ = ausdrücklicher Startauftrag für Astra.</p><p class="f-hint">Änderungen an Monaten und Zuordnungen werden privat gespeichert. Ein beendeter Prüflauf ist noch kein Monatsabschluss.</p><dialog id="fibuHomeModal"></dialog></div>`;
    $('#main .fibu-cockpit').onclick=click;
  }
  async function refresh(){
    if(document.getElementById('fibuHomeModal')?.open){clearTimeout(fibuTimer);fibuTimer=setTimeout(()=>refresh().catch(error),1500);return;}
    const [j,m]=await Promise.all([fibuApi('/jobs?companyId='+company),fibuApi('/months?companyId='+company)]);if(!alive())return;jobs=j.jobs;removedEntries=m.removed||[];const hidden=new Set(removedEntries.map(m=>m.id));
    const map=new Map(m.months.map(m=>[m.id,m]));for(const j of jobs)if(!hidden.has(j.folderId||j.month)&&!map.has(j.folderId||j.month))map.set(j.folderId||j.month,{id:j.folderId||j.month,companyId:company,month:j.month,monthFolderPath:j.sourceMonthPath||j.monthFolderPath,bankPdfPath:j.sourceBankName||j.bankPdfPath,bankDrivePath:j.sourceBankIsDrivePath===true,folderUrl:''});
    months=[...map.values()].sort((a,b)=>b.month.localeCompare(a.month)||(b.createdAt||'').localeCompare(a.createdAt||''));render();clearTimeout(fibuTimer);if(jobs.some(j=>['queued','running'].includes(j.state)))fibuTimer=setTimeout(()=>refresh().catch(error),1500);
  }
  function edit(m){
    if(state.mode==='cloud'){openPicker(m?'folder':'new',m);return;}
    modal(`<h2>${m?'FiBu-Pfade ändern':'FiBu-Monat anlegen'}</h2><p>${esc(CO[company].n)} · Der Prüfmonat wird aus dem Monatsordner abgeleitet.</p><form id="fibuMonthForm"><label>FiBu-Ordnerpfad<input name="folder" required maxlength="2000" value="${esc(m?.monthFolderPath||'')}" placeholder="…\\2026\\10"></label><label>Konkrete Original-Bank-PDF<input name="bank" maxlength="2000" value="${esc(m?.bankPdfPath||'')}" placeholder="Vollständiger Dateipfad"></label><label>OneDrive-Ordnerlink (optional)<input name="url" type="url" value="${esc(m?.folderUrl||'')}" placeholder="https://…"></label><p>Abgeleiteter Prüfmonat: <strong id="fibuDerivedMonth">${m?name(m.month):'Noch nicht erkannt'}</strong></p><div id="fibuModalError" class="f-error" role="alert"></div><div class="f-dialogfoot"><button type="submit" class="primary">Monat speichern</button></div></form>`);
    const f=$('#fibuMonthForm');f.folder.oninput=()=>{const month=fibuMonth(f.folder.value);$('#fibuDerivedMonth').textContent=/^20\d{2}-\d{2}$/.test(month)?name(month):'Noch nicht erkannt';};
    f.onsubmit=async e=>{e.preventDefault();try{await fibuApi('/months',{id:m?.id,create:!m,companyId:company,monthFolderPath:f.folder.value,bankPdfPath:f.bank.value,folderUrl:f.url.value});$('#fibuHomeModal').close();await refresh();savedNotice=m?'FiBu-Eintrag gespeichert.':'Neuer FiBu-Eintrag angelegt. Die Prüfung startet über „Prüfung starten“.';render();toast(savedNotice);}catch(e){$('#fibuModalError').textContent=e.message;}};
  }
  function openPicker(mode,m){
    pickerMode=mode;pickerMonth=m||null;pickerPeriod=m?.month||'';pickerLabel=m?entryName(m):'';pickerNameEdited=!!m;selectedBank=m?.bankPdfPath||'';
    if(selectedBank&&m&&!m.bankDrivePath&&!selectedBank.includes('/'))selectedBank=m.monthFolderPath+'/'+selectedBank;
    let initial=m?.monthFolderPath||c.cloudMonthBase||'';
    if(mode==='bank'&&(selectedBank.includes('/')||m?.bankDrivePath))initial=selectedBank.split('/').slice(0,-1).join('/');
    browse(initial).catch(error);
  }
  async function browse(relative){
    const request=++browseGeneration;
    modal('<h2>OneDrive öffnen</h2><p role="status">Ordner wird geladen …</p>');
    try{
      const data=await fibuApi('/onedrive/'+company+'?path='+encodeURIComponent(relative));
      if(request!==browseGeneration||!alive()||!$('#fibuHomeModal')?.open)return;
      browsePath=data.path;driveEntries=data.entries;
      const month=fibuMonth(browsePath);if(/^20\d{2}-\d{2}$/.test(month))pickerPeriod=month;if(!pickerNameEdited&&/^20\d{2}-\d{2}$/.test(pickerPeriod))pickerLabel='FiBu '+name(pickerPeriod);const valid=/^20\d{2}-\d{2}$/.test(month),parts=browsePath.split('/').filter(Boolean);
      const title=pickerMode==='bank'?'Kontoauszug aus OneDrive auswählen':pickerMode==='view'?'OneDrive-Ordner':pickerMode==='folder'?'FiBu-Ordner aus OneDrive auswählen':'FiBu-Monat aus OneDrive anlegen';
      const full=n=>(browsePath?browsePath+'/':'')+n;
      const chosen=n=>selectedBank===full(n)||(!pickerMonth?.bankDrivePath&&!selectedBank.includes('/')&&pickerMonth?.monthFolderPath===browsePath&&selectedBank===n);
      const entries=[...driveEntries].sort((a,b)=>Number(!!b.folder)-Number(!!a.folder)||a.name.localeCompare(b.name,'de',{numeric:true}));
      const allowFiles=pickerMode==='bank'||pickerMode==='new';
      modal('<h2>'+title+'</h2><p>'+(pickerMode==='folder'?'Belegordner wählen. Der Kontoauszug bleibt separat hinterlegt.':pickerMode==='bank'?'Original-PDF wählen. Der FiBu-Ordner bleibt erhalten.':'Ordner öffnen und die gewünschte Quelle auswählen.')+'</p><nav class="f-drive-crumbs" aria-label="OneDrive-Pfad">'+button('driveFolder','OneDrive',false,'data-path=""')+parts.map((part,i)=>'<span>/</span>'+button('driveFolder',esc(part),false,'data-path="'+esc(parts.slice(0,i+1).join('/'))+'"')).join('')+'</nav>'+(pickerMode==='new'?'<label>Prüfmonat<input id="fibuPickerPeriod" type="month" required value="'+esc(pickerPeriod)+'"></label><label>Name<input id="fibuPickerLabel" maxlength="120" value="'+esc(pickerLabel)+'" placeholder="FiBu MM/JJJJ"></label>':'')+'<div class="f-drive-tools">'+button('driveUp','↑ Übergeordneter Ordner',false,browsePath?'':'disabled')+'<label>Suchen<input id="fibuDriveSearch" type="search" placeholder="In diesem Ordner suchen"></label></div><div class="f-drive-list" aria-label="Dateien und Ordner">'+entries.map(d=>{
        const pdf=d.file&&/\.pdf$/i.test(d.name)&&!/_Astra(?:_|\.)/i.test(d.name);
        return '<div class="f-drive-row" data-drive-name="'+esc(d.name.toLocaleLowerCase('de'))+'">'+(d.folder?button('driveFolder','<span aria-hidden="true">▸</span><span>'+esc(d.name)+'</span><small>Ordner öffnen</small>',false,'data-path="'+esc(full(d.name))+'"'):allowFiles&&pdf?button('driveFile','<span aria-hidden="true">▤</span><span>'+esc(d.name)+'</span><small>PDF · '+Math.max(1,Math.round((d.size||0)/1024))+' KB</small>',false,'data-path="'+esc(full(d.name))+'" aria-pressed="'+chosen(d.name)+'"'):'<span class="f-drive-unavailable">'+esc(d.name)+'<small>'+ (d.file?'Datei':'Nicht auswählbar')+'</small></span>')+'</div>';
      }).join('')+(entries.length?'':'<p>Dieser Ordner ist leer.</p>')+'<p id="fibuDriveNoResults" hidden>Keine passenden Einträge.</p></div><div class="f-path"><strong>Auswahl</strong><p>'+(pickerMode==='bank'?'PDF: '+esc(selectedBank||'Noch keine PDF gewählt'):'Ordner: '+esc(browsePath||'OneDrive-Firmenordner'))+'</p>'+(pickerMode==='new'?'<p>PDF: '+esc(selectedBank||'Noch keine PDF gewählt')+'</p>':'')+'</div><p id="fibuCloudError" class="f-error" role="alert"></p><div class="f-dialogfoot">'+button('closeModal','Abbrechen')+(data.webUrl?'<a class="f-link" href="'+esc(data.webUrl)+'" target="_blank" rel="noopener">In OneDrive öffnen ↗</a>':'')+(pickerMode==='view'?'':button('driveSave',pickerMode==='bank'?'Kontoauszug übernehmen':pickerMode==='folder'?'Diesen FiBu-Ordner übernehmen':'Monat speichern',true,(pickerMode==='bank'?!!selectedBank:pickerMode==='folder'?true:/^20\d{2}-(0[1-9]|1[0-2])$/.test(pickerPeriod)&&!!selectedBank)?'':'disabled'))+'</div>');
      if($('#fibuPickerLabel'))$('#fibuPickerLabel').oninput=e=>{pickerLabel=e.target.value;pickerNameEdited=true;};
      if($('#fibuPickerPeriod'))$('#fibuPickerPeriod').onchange=e=>{pickerPeriod=e.target.value;if(!pickerNameEdited){pickerLabel='FiBu '+name(pickerPeriod);$('#fibuPickerLabel').value=pickerLabel;}document.querySelector('[data-fibu=driveSave]').disabled=!/^20\d{2}-(0[1-9]|1[0-2])$/.test(pickerPeriod)||!selectedBank;};
      $('#fibuDriveSearch').oninput=e=>{let visible=0;document.querySelectorAll('[data-drive-name]').forEach(row=>{row.hidden=!row.dataset.driveName.includes(e.target.value.toLocaleLowerCase('de'));if(!row.hidden)visible++;});$('#fibuDriveNoResults').hidden=!!visible;};
    }catch(e){if(request===browseGeneration&&alive()&&$('#fibuHomeModal')?.open)modal('<h2>OneDrive nicht verfügbar</h2><p class="f-error">'+esc(e.message)+'</p>'+button('driveFolder','Erneut versuchen',false,'data-path="'+esc(relative)+'"'));}
  }
  async function saveDrive(b){
    b.disabled=true;
    try{
      const folder=pickerMode==='bank'?pickerMonth.monthFolderPath:browsePath;
      let bank=pickerMode==='folder'?pickerMonth.bankPdfPath:selectedBank;
      if(pickerMode==='folder'&&!pickerMonth.bankDrivePath&&bank&&!bank.includes('/'))bank=pickerMonth.monthFolderPath+'/'+bank;
      if(!bank)throw Error('Bitte zuerst den Kontoauszug auswählen.');
      const label=pickerMonth?.label||'';const displayName=pickerMonth?entryName(pickerMonth):pickerLabel.trim()||'FiBu '+name(pickerPeriod);
      await fibuApi('/months',{id:pickerMonth?.id,create:!pickerMonth,label,name:displayName,companyId:company,month:pickerMonth?.month||pickerPeriod,monthFolderPath:folder,bankPdfPath:bank,bankDrivePath:true});
      savedNotice=pickerMonth?'OneDrive-Auswahl gespeichert.':'Neuer FiBu-Eintrag angelegt. Die Prüfung startet über „Prüfung starten“.';$('#fibuHomeModal').close();await refresh();toast(savedNotice);
    }catch(e){$('#fibuCloudError').textContent=e.message;b.disabled=false;}
  }
  async function click(e){
    const b=e.target.closest('[data-fibu]');if(!b)return;const action=b.dataset.fibu,entry=b.closest('[data-entry-id]')?.dataset.entryId||contextEntry,m=months.find(m=>m.id===entry),month=m?.month;contextEntry=entry;
    try{
      if(action==='driveFile'){selectedBank=b.dataset.path;await browse(browsePath);return;}
      if(action==='driveSave'){await saveDrive(b);return;}
      if(action==='bank'&&state.mode==='cloud'){openPicker('bank',m);return;}
      if(action==='bank'){edit(m);return;}
      if(action==='driveFolder'){await browse(b.dataset.path);return;}
      if(action==='driveUp'){await browse(browsePath.split('/').slice(0,-1).join('/'));return;}
      if(action==='remove'){
        modal('<h2>Eintrag aus Übersicht entfernen?</h2><p><strong>'+esc(entryName(m))+'</strong></p><p>Nur dieser Eintrag wird ausgeblendet. Dateien und Ordner in OneDrive sowie vorhandene Prüfergebnisse bleiben erhalten. Über die Info-Einstellungen kannst du ihn wiederherstellen.</p><p id="fibuRemoveError" class="f-error" role="alert"></p><div class="f-dialogfoot">'+button('closeModal','Abbrechen')+button('confirmRemove','Eintrag entfernen',true)+'</div>');return;
      }
      if(action==='confirmRemove'){
        b.disabled=true;try{await fibuApi('/months/'+encodeURIComponent(m.id)+'/remove',{companyId:company});lastRemoved=m.id;savedNotice='Eintrag aus der Übersicht entfernt. OneDrive bleibt unverändert.';$('#fibuHomeModal').close();await refresh();}catch(e){$('#fibuRemoveError').textContent=e.message;b.disabled=false;}return;
      }
      if(action==='undoRemove'||action==='restoreEntry'){
        await fibuApi('/months/'+encodeURIComponent(action==='undoRemove'?lastRemoved:b.dataset.entry)+'/restore',{companyId:company});lastRemoved=null;savedNotice='Eintrag wiederhergestellt.';$('#fibuHomeModal').close();await refresh();return;
      }
      if(action==='info'){
        const settings=await fibuApi('/settings/'+company);
        modal(`<h2>Job-Einstellungen &amp; Regeln</h2><p>Aktuelle Einstellungen für ${esc(CO[company].n)}. Sie gelten bei einem ausdrücklich gestarteten Prüflauf.</p><h3>E-Mail-Prüfung &amp; Ablage</h3><ul class="f-rules"><li>Postfach: <strong>${esc(settings.mailbox)}</strong> · Posteingang mit Anhängen; zusätzliche postfachweite Suche nach Rechnungsreferenzen (bis zu 40 eindeutige Suchbegriffe).</li><li>${settings.mailStorage==='privateServer'?'Verifizierte Anhänge werden in der privaten Belegsammlung auf dem Server gespeichert. Zugeordnete Belege liegen in der Arbeitskopie des Prüflaufs.':'Ablage im hinterlegten Sammelordner.'}</li><li>${settings.collectionSource?'Zusätzliche Belegquelle: <span class="f-path-inline">'+esc(settings.collectionSource)+'</span> (bei Serverbetrieb nur lesend).':'Keine zusätzliche Sammelquelle hinterlegt.'}</li><li>Kategorie „ASTRA“ und Flag „Erledigt“: <strong>${settings.pilotMode?'im Pilotmodus deaktiviert':'nach vollständig verifizierter Ablage aller relevanten Anhänge'}</strong>. Vorhandene Kategorien bleiben erhalten; unklare oder nur per OCR erkannte Anhänge lassen die Nachricht offen.</li></ul><h3>Abgleich mit dem Kontoauszug</h3><p>Private Empfänger schließen einen Beleg nicht aus. Die Zuordnung zur Firma muss am Original geprüft und nachvollziehbar bestätigt werden. Bereits bestätigte Tankbelege können bei eindeutig passendem Erstattungszweck, Betrag und Zeitraum wiedererkannt werden.</p><p>${settings.mode==='cloud'?'Belegsuche: ausgewählter Monatsordner und drei Vormonate, jeweils mit Unterordnern bis acht Ebenen. Die OneDrive-Belegquellen werden nur gelesen.':'Belegsuche in den hinterlegten lokalen Ordnern.'} Frühere PDF-Markierungen werden nicht als Belegzuordnung übernommen.</p><ul class="f-rules"><li><strong>Grün:</strong> Positive Gutschriften von ${settings.greenCounterparties.length?esc(settings.greenCounterparties.join(', ')):'keinen konfigurierten Gegenparteien'}. Eine grüne Markierung bestätigt noch keinen Beleg.</li><li><strong>Lila:</strong> ${settings.payrollExceptions?'Hinterlegte Lohn-/Vorschuss- und Sachbezugsregeln, z. B. „Kto Lohn“: kein Beleg notwendig. Gebühren und Abrechnungen der Sachbezugskarte bleiben prüfpflichtig.':'Lohn-Ausnahmeregeln sind nicht aktiviert.'}</li><li><strong>Gelb:</strong> Passender Beleg wurde verifiziert abgelegt. Betrag und Referenz bzw. Gegenpartei müssen passen; ein Betrag allein genügt nicht.</li><li><strong>Ohne Farbe:</strong> Offen oder mehrdeutig; manuelle Klärung erforderlich.</li><li>OCR: ${settings.ocrEnabled?'aktiv; automatische Zuordnung nur mit zusätzlichem eindeutigen Banknachweis, sonst am Original bestätigen':'nicht aktiviert'}. Original-Bankkonto und Auszugszeitraum werden geprüft.</li></ul><h3>PDF &amp; Ausführung</h3><p>${settings.mode==='cloud'?'Serverbetrieb: läuft auch bei ausgeschaltetem PC. Die ausgewählte OneDrive-Bank-PDF wird nach verifizierter Originalsicherung mit Farben aktualisiert.':'Ausführung über den konfigurierten Rechner.'} Ein Lauf schließt den Monat nicht automatisch ab.</p><h3>Verbindung &amp; Belegquellen</h3><p>Microsoft: <strong>${c.connected?'verbunden':'nicht verbunden'}</strong>${state.mode==='cloud'?' · OneDrive-Schreibzugriff: '+(c.canWrite?'aktiv':'nicht freigegeben'):''}</p><div class="f-settings-actions">${c.canConnect&&c.microsoftConfigured?(c.connected?button('probe','Postfachzugriff prüfen')+(state.mode==='cloud'&&!c.canWrite?button('connect','OneDrive-Schreibzugriff freigeben'):'')+button('disconnect','Verbindung trennen'):button('connect','Microsoft verbinden',true)):''}${button('sources','Belegquellen & Portalzugänge',false,c.enabled?'':'disabled')}</div>${removedEntries.length?'<h3>Entfernte Einträge</h3><p>Nur aus dieser Übersicht entfernt; Dateien und Ergebnisse sind erhalten.</p><div class="f-removed-list">'+removedEntries.map(m=>'<p><span>'+esc(entryName(m))+'</span>'+button('restoreEntry','Wiederherstellen',false,'data-entry="'+esc(m.id)+'"')+'</p>').join('')+'</div>':''}<div class="f-dialogfoot">${button('closeModal','Schließen')}</div>`);return;
      }
      if(action==='rename'){
        modal('<h2>Name bearbeiten</h2><form id="fibuNameForm"><label>Name<input name="displayName" required maxlength="120" value="'+esc(entryName(m))+'"></label><p id="fibuNameError" class="f-error" role="alert"></p><div class="f-dialogfoot">'+button('closeModal','Abbrechen')+'<button type="submit" class="primary">Name speichern</button></div></form>');
        const f=$('#fibuNameForm');f.displayName.focus();f.displayName.select();f.onsubmit=async e=>{e.preventDefault();const submit=f.querySelector('[type=submit]');submit.disabled=true;try{await fibuApi('/months/'+encodeURIComponent(m.id)+'/name',{companyId:company,name:f.displayName.value});savedNotice='Name gespeichert.';$('#fibuHomeModal').close();await refresh();}catch(e){$('#fibuNameError').textContent=e.message;submit.disabled=false;}};return;
      }
      if(action==='sources'){
        const data=await fibuApi('/sources/'+company);
        modal(`<h2>Belegquellen &amp; Portalzugänge</h2><p>E-Post: ${c.connected?'verbunden':'nicht verbunden'} · Firmenordner: ${state.mode==='cloud'?'OneDrive direkt auf dem Server':'synchronisierter Windows-Ordner'}.</p><p>Lieferantenbelege können im Portal heruntergeladen und hier importiert werden. Es ist aktuell keine automatische Portal-Anmeldung oder Portalprüfung eingerichtet.</p><table style="width:100%;text-align:left"><thead><tr><th>Quelle</th><th>Status</th></tr></thead><tbody>${data.sources.map(s=>`<tr><td>${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>`:esc(s.name)}</td><td>${esc(s.status)} · Anmeldung im Browser erforderlich</td></tr>`).join('')}</tbody></table><h3>Heruntergeladenen Beleg importieren</h3><p>PDF oder Bild in den Sammelordner übernehmen. Der Import bestätigt noch keine Firma oder Zuordnung und startet keinen Prüflauf.</p><form id="fibuImportForm"><label>Quelle<select name="source">${data.sources.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><label>Prüflauf (optional)<select name="jobId" ${state.mode==='remote'?'disabled':''}><option value="">Nur im Sammelordner speichern</option>${months.map(m=>({m,j:latest(m)})).filter(x=>x.j?.transactions?.length&&!(['queued','running'].includes(x.j.state))).map(x=>`<option value="${esc(x.j.id)}">${esc(entryName(x.m))}</option>`).join('')}</select></label><label>Datei<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required></label><p id="fibuImportStatus" role="status"></p><button class="primary">Beleg importieren</button></form>`);
        const f=$('#fibuImportForm');f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;try{const file=f.file.files[0];if(!file||file.size>25*1024*1024)throw Error('Datei bis 25 MB wählen.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Datei nicht lesbar.'));reader.readAsDataURL(file);});const imported=await fibuApi('/imports/'+company,{source:f.source.value,name:file.name,data,...(f.jobId.value?{jobId:f.jobId.value}:{})});$('#fibuImportStatus').textContent=imported.jobId?'Beleg im gewählten Prüflauf gespeichert. Dort am Original prüfen und zuordnen; kein neuer Voll-Lauf nötig.':'Beleg gespeichert. Beim nächsten ausdrücklichen Prüflauf werden Firma und Zuordnung geprüft.';f.file.value='';}catch(e){$('#fibuImportStatus').textContent=e.message;}finally{b.disabled=false;}};return;
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
      if(action==='closeModal'){browseGeneration++;$('#fibuHomeModal').close();return;}
      if(action==='new'){edit(null);return;}
      if(action==='edit'){edit(m);return;}
      if(action==='open'){if(latest(m))viewFibu(company,month,m.id,entryName(m));else edit(m);return;}
      if(action==='folder'&&state.mode==='cloud'){openPicker('view',m);return;}if(action==='folder'){modal(`<h2>FiBu-Ordner</h2><div class="f-path">${esc(m.monthFolderPath)}</div><p>Der Ordner liegt auf dem verbundenen Rechner. Ein hinterlegter OneDrive-Weblink öffnet ihn im Browser.</p>${m.folderUrl?`<a class="f-link" href="${esc(m.folderUrl)}" target="_blank" rel="noopener">Ordner öffnen ↗</a>`:button('edit','Ordnerlink hinterlegen')}`);return;}
      if(action==='start'){
        if(!m.bankPdfPath){edit(m);return;}
        modal(`<h2>Astra FIBU starten</h2><p>Du beauftragst die Prüfung dieser Firma und dieses Monats. Die ausgewählte OneDrive-Bank-PDF wird mit Farben aktualisiert; eine unveränderte Originalfassung wird vorher gesichert.</p><div class="f-path"><b>${esc(CO[company].n)} · ${esc(entryName(m))}</b><p>Belegordner: ${esc(m.monthFolderPath)}</p><p>Kontoauszug: ${esc(m.bankPdfPath)}</p></div><p>Belege sammeln, mit Bankbuchungen abgleichen und eine markierte Kopie speichern. Unklare Zuordnungen bleiben offen.</p><div id="fibuModalError" class="f-error" role="alert"></div><div class="f-dialogfoot">${button('closeModal','Abbrechen')}${button('confirmStart','▶ Prüfung starten',true)}</div>`);return;
      }
      if(action==='confirmStart'){b.disabled=true;try{await fibuApi('/jobs',{companyId:company,folderId:m.id,month:m.month,monthFolderPath:m.monthFolderPath,bankPdfPath:m.bankPdfPath,bankDrivePath:m.bankDrivePath===true});viewFibu(company,month,m.id,entryName(m));}catch(e){$('#fibuModalError').textContent=e.message;b.disabled=false;}return;}
    }catch(e){error(e);}
  }
  $('#main').innerHTML='<p>FiBu-Monate werden geladen …</p>';
  try{state=await fibuApi('/companies');if(!alive())return;c=state.companies.find(c=>c.id===company);if(c?.enabled)await refresh();else render();}catch(e){$('#main').innerHTML='<p class="f-error">'+esc(e.message)+'</p>';}
}

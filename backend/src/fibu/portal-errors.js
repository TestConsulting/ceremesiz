// Fixed messages only: raw browser exceptions can contain credentials.
function portalErrorMessage(e){
 if(e.code==='browser_closed')return 'Der Browserprozess auf dem Server wurde vor Abschluss beendet. Die Anmeldung konnte deshalb nicht geprüft werden.';
 if(e.code==='browser_unavailable')return 'Der Server konnte den Prüfprozess nicht starten. Server-Browserinstallation prüfen.';
 if(e.diagnostics?.signals?.includes('credentials_rejected')||/Zugangsdaten nicht erkannt/i.test(e.diagnostics?.loginNotice||''))return 'Der Lieferant meldet ungültige Anmeldedaten. Benutzername und Passwort im gespeicherten Zugang prüfen.';
 if(e.diagnostics?.signals?.includes('captcha_rejected'))return 'Die Sicherheitsprüfung des Lieferanten wurde nicht akzeptiert. Eine automatische Anmeldung konnte nicht abgeschlossen werden.';
 if(e.code==='cancelled')return 'Portalprüfung abgebrochen.';
 if(e.code==='timeout')return 'Portalprüfung nach 3 Minuten beendet: Der Lieferant hat nicht rechtzeitig geantwortet. Erneut testen.';
 if(e.code==='login_not_verified')return 'Angemeldetes Konto nicht erkannt. Die Anwendung konnte den Login nicht bestätigen; die Portal-Anbindung muss geprüft werden.';
 if(e.code==='interaction_required')return 'Login nicht abgeschlossen: Die Anmeldeseite ist weiterhin sichtbar oder eine Bestätigung steht aus. Ein falsches Passwort ist damit nicht nachgewiesen.';
 const messages={
 browser_start:'Der Server konnte den Portal-Browser nicht starten. Die Browserinstallation auf dem Server muss geprüft werden.',
 login_page:'Die Anmeldeseite konnte nicht geladen werden. Portaladresse und Erreichbarkeit prüfen.',
 cookie_consent:'Der Cookie-Dialog konnte nicht geschlossen werden. Die Portal-Anbindung muss angepasst werden.',
 username:'Das Benutzerfeld konnte nicht ausgefüllt werden. Den Auswahlpfad für das Benutzerfeld prüfen.',
 login_next:'Der nächste Anmeldeschritt konnte nicht geöffnet werden. Die Portal-Anbindung muss angepasst werden.',
 password:'Das Passwortfeld konnte nicht ausgefüllt werden. Den Auswahlpfad für das Passwortfeld prüfen.',
 login_submit:'Der Anmeldebutton konnte nicht betätigt oder die anschließende Seite nicht geladen werden. Auswahlpfad, Cookie-Dialog oder Sicherheitsprüfung können den Login verhindern.',
 confirmation:'Die zusätzliche Anmeldebestätigung konnte nicht abgeschlossen werden. Direkt im Lieferantenportal prüfen.',
 verify_login:'Die Anmeldung konnte technisch nicht überprüft werden. Die Portal-Anbindung muss geprüft werden.',
 invoice_page:'Die Rechnungsübersicht konnte nicht geöffnet werden. Rechnungsadresse und Auswahlpfad prüfen.',
 download:'Der Rechnungsdownload ist fehlgeschlagen. Download-Auswahlpfad und PDF-Bereitstellung beim Lieferanten prüfen.'};
 return messages[e.diagnostics?.step]||'Portalprüfung fehlgeschlagen. Die genaue Fehlerstelle wurde bei diesem Versuch nicht erfasst. Erneut testen, um eine genauere Diagnose zu erhalten.';
}
module.exports={portalErrorMessage};

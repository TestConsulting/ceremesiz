# Astra FIBU - lokaler Entwicklungsstand

Entwicklungsbranch: `codex/astra-fibu`. Keine Veröffentlichung, kein Push, keine Änderung der laufenden Produktion. Basis ist das tatsächliche Holding-Portal mit Express, SQLite und bestehenden Sessions. Der Vorschau-Worker ersetzt dessen Anmeldung nicht.

## Lokal ansehen

Node ab 22.13, für den geprüften Stand wurde Node 24.14.1 verwendet.

```powershell
cd backend
npm.cmd ci
npm.cmd test
npm.cmd run fibu:demo
```

Die Demo bindet ausschließlich `127.0.0.1:4088`, nutzt eine eigene temporäre Datenbank und synthetische PDFs. Anmeldung und Demo-Passwort werden im Terminal ausgegeben. Danach `/intern#fibu-tc` öffnen. Der bekannte Demo-Zugang wird niemals in der produktiven Datenbank angelegt. Demo mit Strg+C beenden. Der Demo-Start lädt keine produktive `.env`.

## Implementiert

- Finanzbuchhaltung unter TestConsulting, AC Immo Invest und Holding; Freischaltung und Benutzerberechtigung je Firma. AC Immo/Holding zusätzlich mit `pilotAccepted`, ProPersonalTeam nicht aktiviert.
- Monatsübersicht nach der gelieferten Cockpit-Vorlage: breite Karten mit blauer Kante, Fortschritt, PDF/Ordner/Pfad-Aktionen und grünem Play-Button. Monate/Pfade werden in Dialogen gespeichert; Speichern startet keinen Prüflauf. Die Detailansicht bleibt der PDF-/Belegprüfung vorbehalten.
- Bestehende Session-Anmeldung, CSRF- und Origin-Prüfung. Alle Job-/Dateiabfragen sind nach Benutzer und Firma beschränkt.
- Dauerhafte SQLite-Jobs, globaler Doppelstartschutz je Firma/Monat, Abbruch, Protokoll, klare Trennung von Startversuch und erfolgreicher Dokumentprüfung. Monatsabschluss erfordert eine gesonderte Aktion und scheitert bei offenen Belegen/Quellfehlern.
- Monat ausschließlich aus dem Ordner `Jahr/Monat`. Realpath-Prüfung gegen Firmenwurzel einschließlich Junction-/Symlink-Ausbruch. Bank muss im Monatsordner liegen. Originalhash, IBAN, Kontoinhaber und ausdrücklich lesbarer Auszugszeitraum werden vor Dokument-Schreibaktionen geprüft.
- Textbasierte Bank-PDFs, stabile Buchungs-IDs samt Seitenkoordinaten, dokumentierter konservativer Parser. Unbekannte Layouts werden nicht als erfolgreich gelesen ausgegeben.
- Lokale Bestandsbelege plus Sammelordner, Firmen-/Betrags-/Referenzprüfung, manuelle Zuordnung/Aufhebung, referenzbasierte Teil-/Sammelzahlungen mit geprüfter Summe. _Astra-Kopien werden exklusiv und hashverifiziert geschrieben, Kollisionen aufgelöst; keine Originaldatei wird überschrieben oder gelöscht.
- Grün nur für positive Zahlungen mit identifizierter konfigurierter Gegenpartei; Belegstatus bleibt separat. Lila-Regeln mit PayCenter-/Abrechnungsgebühr-Ausschluss, gelb erst nach verifizierter Belegablage.
- Markierungen immer auf Basis der unveränderten Originalbank neu erzeugt. Vorhandene Inhalte/Annotationen bleiben erhalten. Text und Seitenzahl werden nach dem Speichern gegengeprüft.
- Microsoft-Device-Code-Anmeldung mit Token ausschließlich im Serverspeicher, Refresh und Trennung. Graph-E-Post-Import inkl. gezielter historischer Hays-Referenzsuche, nachvollziehbarer Herkunft und Anhangshash. Outlook-Kategorien werden ergänzt statt ersetzt, ASTRA-Schreibweise im gelesenen Posteingang wiederverwendet, vorhandenes ETag schützt vor konkurrierender Änderung. Erledigt-Markierung erst nach vollständiger verifizierter lokaler Ablage; Teilfehler bleiben offen.
- Windows-Ausführungsdienst über ausgehendes HTTPS-Polling. Kein offener Windows-Port, kein Tunnel, keine Shell-Ausführung aus Portalparametern. Der Dienst führt nur ausdrücklich angelegte Jobs aus. Firmengebundener 256-Bit-Kopplungsschlüssel, exklusive Auftragsübernahme, kurzlebige Auftragskopplung und Heartbeats. Verwaiste Aufträge werden zur Prüfung angehalten und nicht automatisch erneut ausgeführt.
- Private Ergebnisübertragung zurück ins Portal mit Hashprüfung, Zugriff nur auf eigene Jobs. Private Ergebnisdateien liegen unter `backend/data/fibu-remote` bzw. neben der konfigurierten Datenbank. Manuelle Aufhebung/Zuordnung wird im Remote-Modus ebenfalls durch den Windows-Dienst ausgeführt.

## Einrichtung für einen echten TestConsulting-Pilot

1. `backend/fibu.config.example.json` nach `backend/data/fibu.config.json` kopieren. Tatsächlich synchronisierte Firmenwurzel, vorhandenen Sammelordner, verifizierten Kontoinhaber/IBAN sowie erlaubte Login-E-Mail-Adressen eintragen. TestConsulting erst danach aktivieren. In einer Arbeitskopie des Monats testen.
2. Zuerst alles lokal: `FIBU_CONFIG_PATH` auf diese Datei setzen, `mode: local`, normalen Backend-Start verwenden. Bestehende Portalbenutzer anmelden; keine fremde Header-Identität.
3. Microsoft-Entra-App im eigenen Tenant registrieren und Device-Code/Public-Client-Anmeldung freigeben lassen. Delegierte Berechtigungen: `User.Read`, `Mail.ReadWrite.Shared` (eigene und freigegebene Postfächer) sowie `offline_access`. Keine Versandberechtigung. Tenant-/Client-ID sind Konfigurationswerte, kein Client-Secret wird benötigt. Zugriff des angemeldeten Benutzers auf `epost@testconsulting.de` muss bestehen. Neue Berechtigungen werden ausschließlich durch den Nutzer/Admin freigegeben.
4. Die Microsoft-Verbindung ist für erlaubte Portalbenutzer bereits möglich, solange die Buchhaltungsverarbeitung noch gesperrt ist. „Postfachzugriff prüfen“ liest nur die angemeldete Identität und Posteingangsmetadaten; Nachrichten und Kategorien bleiben unverändert. Im FIBU-Bereich „Microsoft verbinden“, den angezeigten Code auf der Microsoft-Seite bestätigen und „Anmeldung prüfen“ wählen. Die Verbindung ist nach Backend-Neustart erneut nötig; Tokens werden nicht auf Platte/Git/Browser-JavaScript gespeichert.
5. Für das spätere getrennte Produktionsportal: Portal-Konfiguration auf `mode: remote` setzen. Gleichen zufälligen `FIBU_RUNNER_SECRET` und `FIBU_RUNNER_COMPANY=tc` auf beiden Systemen sicher hinterlegen. `FIBU_PORTAL_URL=https://www.ceremesiz-holding.de` nur auf Windows setzen. Windows verwendet seine eigene Konfiguration mit `mode: local` und den dort tatsächlich existierenden Pfaden. Dienst manuell mit `npm.cmd run fibu:runner` starten. Ohne Dienst bleibt ein ausdrücklich angelegter Auftrag in der Warteschlange.
6. Konfiguration für den Produktionscontainer unter dem bereits vorhandenen privaten `backend/data`-Volume ablegen. Dockerfile und Nginx-Beispiel wurden für Bibliotheken und authentifizierte Ergebnisübertragung vorbereitet. Änderungen wurden nicht deployed. Die Beispielkonfiguration muss vor einem später gesondert freigegebenen Deployment mit der tatsächlichen Serverkonfiguration abgeglichen werden.

Die Kopplung berechtigt genau den konfigurierten Firmen-Dienst zur Auftragsbearbeitung und zum Lesen/Zurückliefern der für diese Jobs benötigten Dateien. Der Schlüssel ist wie ein Passwort zu schützen und bei Verlust auf beiden Seiten zu ersetzen. Keine echten Pfade, IBANs, Tokens oder Schlüssel committen.

## Verifizierter Stand und Abgrenzung

Am 16.11.2026 wurde die echte Microsoft-Anmeldung mit der eigenen mandantenbeschränkten App und den delegierten Rechten User.Read, Mail.ReadWrite.Shared und offline_access geprüft. Der E-Post-Posteingang war erreichbar (131 Nachrichten zum Prüfzeitpunkt). Die ausdrücklich genehmigte Vollzugriffsdelegierung für Taner wurde ergänzt; bestehende Mitglieder blieben erhalten. Tokens bleiben nur im Prozessspeicher. Neustart erfordert erneut Microsoft verbinden.

Der bestätigte Pilot verwendet TestConsulting, Oktober 2026, Kontoendung 4831 ausschließlich in einem Arbeitsordner unter Documents/Codex. Der tatsächliche Sparkassen-Druckansichtparser liest 147 Buchungen auf acht Seiten mit bestandener Anzahl- und Saldenkontrolle. Der echte E-Post-/Dateiabgleich ergab sieben Zuordnungen und 51 Buchungen ohne Belegpflicht. 89 Buchungen blieben offen. Die Bankdatei in OneDrive und die unveränderte Originalkopie blieben hashidentisch. Die markierte PDF wurde auf Text- und Seitenzahlerhalt geprüft; gelbe, grüne und lila Bereiche wurden gerendert und visuell kontrolliert.

### OCR und manuelle Prüfung

- `ocrEnabled: true` aktiviert lokale OCR für Bilder und PDFs ohne ausreichende Textschicht. Deutsch und Englisch werden zusammen mit der Anwendung installiert. Zur Laufzeit findet kein Modell-Download und keine Übertragung an einen OCR-Anbieter statt.
- OCR läuft seriell in einem getrennten Prozess, mit maximal zehn Seiten, 16 Millionen Pixeln pro Seite und 120 Sekunden je Beleg. Fehler bleiben sichtbar und verhindern keine Prüfung anderer Belege.
- OCR-Daten sind Vorschläge. Automatische Einzel-, Teil- und Sammelzuordnung sind bis zur Bestätigung am Original gesperrt. Die Belegprüfung erfasst Firma, EUR-Bruttobetrag, Rechnungssteller, Referenz, Datum und Begründung; bestätigt wird nur mit ausdrücklich gesetzter Originalprüfung. Benutzer, Firma und Dateihash begrenzen die dauerhafte Bestätigung. Eine geänderte Datei übernimmt keine alte Bestätigung.
- Der ergänzende Offline-Test mit echten Kopien las acht Scanbelege per OCR. Alle acht blieben prüfpflichtig; die Zahl automatischer Zuordnungen wurde nicht künstlich erhöht.
- Nicht alle Lieferantenlayouts liefern eindeutig beschriftete Beträge oder Firmen. Solche Dokumente benötigen die Belegprüfung; keine Steuer- oder Buchungsentscheidung wird automatisiert.

### Lieferantenquellen

Auf ausdrücklichen Wunsch werden STRATO, B2Mobility/FuelsCard, Microsoft-Rechnungsportal, Amazon, HUK und Sachbezugskarte später einzeln angebunden. Die Oberfläche zeigt unter „Belegquellen & Portalzugänge“ alle vorgemerkten Quellen, vorhandene Portaladressen und den ungeprüften Anmeldestatus. Keine dieser Quellen wird derzeit automatisch geprüft.

Heruntergeladene PDF-/Bildbelege lassen sich bereits geschützt importieren. Herkunft, Originalname, Benutzer und SHA-256 werden gespeichert. Import startet keinen Lauf und bestätigt keine Zuordnung. Der gekoppelte Windows-Dienst übernimmt diese Dateien hashgeprüft in seinen Sammelordner. Sitzungsanmeldung, CSRF, Firmenberechtigung, Dateisignatur und Größenbegrenzung gelten auch für den Import.

### Gekoppelter Betrieb und Deployment

Jenkins-Job: ceremesiz. Bisheriger produktiver Stand: 8b763a4, Verzeichnis /var/www/ceremesiz-app, Docker-Service backend, Host-Port 127.0.0.1:4010. Der Read-only-Preflight Build 23 war erfolgreich; bislang existieren dort weder FIBU-Konfiguration noch Runner-Schlüssel.

`Jenkinsfile` bereitet die Veröffentlichung über den bestehenden Job vor: Sicherung von SQLite, Konfiguration und bisherigem Image, Fast-Forward aus main, isolierte Tests im neuen Image ohne externes Netzwerk, private Einrichtung über ein maskiertes Jenkins-Secret-Text-Binding `astra-fibu-tc-bootstrap`, Deployment und Healthcheck. Fehler stellen Image und private Konfiguration wieder her; die laufende Datenbank wird nicht automatisch durch eine alte Sicherung ersetzt.

`backend/scripts/configure-fibu.cjs` verarbeitet das private Binding mit `config` und `runnerSecret`. Der Schlüssel steht nicht in Git oder im Pipeline-Skript. Vorhandene Session-/Login-Konfiguration bleibt erhalten. `backend/scripts/start-local-runner.cjs` liest ausschließlich die ignorierte Datei `backend/data/fibu-runner.private.json` (Portal-URL, Schlüssel, Firma, lokaler Konfigurationspfad). Start erfolgt manuell; es wird kein Zeitplan installiert. Der Runner pollt ausdrücklich angelegte Aufträge und meldet seine Erreichbarkeit. Der Windows-Rechner muss für die Dateiverarbeitung eingeschaltet und verbunden sein.

`pilotMode: true` bleibt für die bestätigte Arbeitskopie aktiv: keine Outlook-Kategorien oder Erledigt-Markierungen, kein produktiver Monatsabschluss, keine Veränderung der Originalordner. Die Produktionswebsite kann diesen Pilotmodus bereitstellen; dies ist keine Freigabe zur Verarbeitung von Originalordnern.

### Validierung und verbleibende Grenzen

Die automatisierten Tests verwenden synthetische Daten. Aktuell: 24 Tests, 23 bestanden, kein Fehler; ein Junction-Test wird unter dieser Windows-Sandbox übersprungen, weil sie das Erstellen der Verknüpfung blockiert. Traversal und externe absolute Pfade sind tatsächlich geprüft. Das reale Sparkassenlayout, OCR auf Dateikopien und der reale E-Post-Pilot sind zusätzliche Integrationsprüfungen; Graph-Protokolltests bleiben Mocks. Browsergeprüft sind Quellenübersicht und Belegbestätigung mit synthetischer Vorlage.

Dateien maximal 25 MB, Rückübertragung maximal 70 MB pro Auftrag; größere Ergebnisse bleiben Teilfehler. OneDrive wird über seinen synchronisierten Windows-Ordner gelesen. AC Immo und Holding bleiben bis zu eigener Konfiguration und TestConsulting-Abnahme gesperrt. Kein Collmex, keine Zahlungen, kein E-Mail-Versand, kein DATEV-Upload, keine automatische Monatsfreigabe, keine Zeitpläne.
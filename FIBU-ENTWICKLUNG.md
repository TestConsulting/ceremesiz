## Gemeinsame FiBu und konfigurierbare Regeln (19.11.2026)

Alle angemeldeten Portalbenutzer teilen die eingerichteten FiBu-Firmen und deren Einträge, Läufe, Belege und Regeln. Es gibt keine zusätzliche FiBu-Benutzerfreigabe. Die bestehende Microsoft-Firmenverbindung wird über den stabilen technischen Arbeitsbereichsinhaber verwendet; die verschlüsselten Token werden nicht zwischen Konten kopiert. Anmeldung und CSRF-/Origin-Prüfungen bleiben aktiv.

Unter **Einstellungen → FiBu** sind Reihenfolge, Suchbegriffe, Suchfeld, Übereinstimmung, Buchungsrichtung, Farbe, Hinweis und Aktivierung editierbar. Speicherung erfolgt firmenweit in SQLite mit Versionsprüfung. Acht Krankenkassen sind standardmäßig in beiden Buchungsrichtungen lila und belegfrei; konfigurierte positive Rechnungsgutschriften sind grün und ebenfalls belegfrei. Für ignorierte Buchungen werden keine zusätzlichen Rechnungsreferenzen gesucht und keine Belege in den Zielmonat übernommen. Vorhandene, sonst nicht zugeordnete Dateien werden nach `00_Nicht zugewiesene Belege` verschoben. Normale Belastungen derselben Firmen bleiben belegpflichtig.

Die Aktion **Vollständig setzen** kennzeichnet den FiBu-Eintrag manuell in Grün, unabhängig von der Zahl automatisch zugeordneter Buchungen. Sie startet keinen Lauf und ersetzt keinen fachlichen Monatsabschluss. Beide Benutzer können sie rückgängig machen. Ein neu gestarteter Lauf hebt diese manuelle Kennzeichnung auf.

# Astra FIBU – Serverbetrieb

Astra erweitert das vorhandene private Holding-Portal (Express, SQLite, bestehende Login-Sessions). Der gewünschte Standard ist `mode: cloud`: Die Prüfung wird auf dem Server ausgeführt und kann vom Handy gestartet werden. Der Windows-PC, sein OneDrive-Synchronisationsclient und ein Windows-Dienst werden dafür nicht benötigt.

## Ablauf

1. Im privaten Bereich TestConsulting → Finanzbuchhaltung öffnen und das berechtigte Microsoft-Konto verbinden.
2. Über „+ Monat“ den OneDrive-Ordner Jahr/Monat und die konkrete Original-Bank-PDF wählen. Speichern startet keine Verarbeitung.
3. „Prüfung starten“ beauftragt einen asynchronen Serverlauf. OneDrive-Dateien werden direkt heruntergeladen; die Quelle bleibt unverändert. Jede Arbeitskopie erhält Herkunft und Version. Eine während des Downloads geänderte Datei wird abgewiesen.
4. Kontoinhaber, konfigurierte IBAN, Auszugszeitraum, Anzahl und Salden des unterstützten Sparkassenlayouts werden geprüft. Erst danach werden E-Post und Belege verarbeitet.
5. Der Nutzer sieht den Status, offene Buchungen, Belege und die markierte PDF in der Website. Er kann die Seite schließen und später zurückkehren; die Verarbeitung läuft auf dem Server weiter. Ein abgebrochener Serverprozess wird zur Prüfung angehalten und nicht still automatisch erneut gestartet.

## Zugriff und Speicherung

- Zugriff nur mit der bestehenden Portal-Anmeldung, Firmenberechtigung und CSRF-Prüfung. Neue Aufträge, Bestätigungen und Dateiabrufe sind benutzergebunden. Firma/Monat haben eine globale Sperre gegen parallele Läufe.
- Microsoft verwendet die eigene mandantenbeschränkte Public-Client-App mit delegierten Rechten `User.Read`, `Mail.ReadWrite.Shared`, `offline_access` und im Cloud-Modus zusätzlich `Files.Read`. Der OneDrive-Zugriff liest ausschließlich unter der konfigurierten Firmenwurzel. Es gibt keine OneDrive-Schreib-/Löschoperationen.
- Microsoft-Zugänge werden mit AES-256-GCM in SQLite verschlüsselt. Der private `FIBU_TOKEN_KEY` liegt getrennt in der Serverumgebung. Benutzer/Firma sind kryptografisch gebunden. Refresh ist über Neustarts möglich; „Verbindung trennen“ entfernt den gespeicherten Zugang. Microsoft kann jederzeit eine erneute Anmeldung verlangen.
- Pre-authentifizierte OneDrive-Downloadadressen bleiben im Serverprozess. Kein Graph-Bearer wird an deren Downloadhost weitergereicht; Ziele, Größe, Dateiversion und verfügbare SHA-1-Quellprüfsummen werden geprüft. Die Ergebnisablage verwendet zusätzlich SHA-256.
- Arbeitskopien und Ergebnisse liegen im privaten Datenvolume unter `fibu-cloud/<Firma>/<Benutzer>/`. Jede Bankrevision erhält einen eigenen Jobordner. Originale in OneDrive werden nicht umbenannt, überschrieben oder gelöscht.
- `pilotMode: true` sperrt Outlook-Kategorien/Erledigt-Markierungen sowie den produktiven Monatsabschluss. Ohne Pilotmodus wird Outlook erst nach vollständiger verifizierter Belegablage markiert. Eine vollständig gelesene Bank ist kein automatisch abgeschlossener Monat.

## Belegprüfung

Betrag allein erzeugt keine automatische Zuordnung. Betrag plus Rechnungsreferenz oder eindeutiger Rechnungssteller werden benötigt; widersprüchliche Summen und mehrfach passende Belege bleiben offen. Teil-/Sammelzahlungen werden nur bei eindeutigen Referenzen und geprüfter Gesamtsumme bestätigt.

Grün kennzeichnet konfigurierte positive Rechnungsgutschriften ohne Belegbedarf und ohne Belegübernahme. Lila folgt den ausdrücklich konfigurierten betrieblichen Ausnahmen. PayCenter-Abrechnungsgebühren bleiben belegpflichtig. Gelb bedeutet verifizierte Ablage eines Belegs. Eigene Markierungen werden stets aus der unveränderten Bank neu erzeugt; Text und Seitenzahl werden anschließend geprüft.

`ocrEnabled: true` liest Bilder und gescannte PDFs lokal auf dem ausführenden Server. Deutsch/Englisch und Modelle werden mit der Anwendung installiert; Dokumente werden an keinen OCR-Anbieter übertragen. Maximal zehn Seiten, 16 Millionen Pixel je Seite und 120 Sekunden je Dokument. OCR läuft in einem getrennten Prozess und liefert ausschließlich prüfpflichtige Vorschläge. Automatisches Matching bleibt bis zur Bestätigung am Original gesperrt. Firma, EUR-Bruttobetrag, Rechnungssteller, Referenz, Datum, Benutzer, Hash und Begründung werden für diese Bestätigung gespeichert.

## Portalquellen

„Belegquellen & Portalzugänge“ zeigt STRATO, B2Mobility/FuelsCard, Microsoft-Rechnungsportal, Amazon, HUK und Sachbezugskarte. Die Lieferantenportale werden auf ausdrücklichen Wunsch erst nach der funktionierenden Basis ergänzt. Sie sind als vorgemerkt und Anmeldung ungeprüft ausgewiesen. Keine Quelle wird fälschlich als automatisch geprüft dargestellt.

Ein geschützter manueller PDF-/Bildimport ist vorbereitet. Er speichert Herkunft und Hash, bestätigt keine Firma und startet keinen Lauf. Backend-Limit: 25 MB je Datei. Der produktive Reverse Proxy muss das konfigurierte Upload-Limit ebenfalls zulassen. OneDrive-Leseabrufe benötigen keine großen eingehenden HTTP-Requests an das Portal.

## Einrichtung und Veröffentlichung

- `backend/fibu.config.example.json` enthält das Cloud-Schema. Echte Konfiguration ausschließlich unter `backend/data/`; keine Zugangsdaten oder Finanzdaten committen.
- TestConsulting zunächst allein aktivieren. Verifizierte Kontozuordnung, berechtigte Portal-E-Mails sowie relativen OneDrive-Firmenordner, Monatsbasis und Sammelordner eintragen. AC Immo/Holding bleiben bis eigener Konfiguration und Abnahme gesperrt.
- Jenkins-Job `ceremesiz` verwendet `/var/www/ceremesiz-app`. `Jenkinsfile` sichert Datenbank, bisheriges Image und private Konfiguration, aktualisiert main per Fast-Forward, baut und testet das Image isoliert ohne externes Netzwerk, konfiguriert FIBU und prüft anschließend den gestarteten Dienst.
- Das maskierte Secret-Text-Binding `astra-fibu-cloud-bootstrap` enthält `{"config": <private Cloud-Konfiguration>}`. Es enthält keinen Windows-Kopplungsschlüssel. `backend/scripts/configure-fibu.cjs` erzeugt den Verschlüsselungsschlüssel einmalig und erhält bestehende Portal-Loginwerte. Schlüssel und Tokens erscheinen nicht im Buildprotokoll.
- Fehlgeschlagene Veröffentlichung stellt das vorherige Image und die private Konfiguration wieder her. Die Datenbank wird nicht automatisch auf einen alten Stand zurückgesetzt. Sicherungen liegen im privaten Datenvolume.
- `mode: local` und `mode: remote` bleiben für ältere lokale Integrationen vorhanden. Der Windows-Runner ist für den gewünschten Cloud-Betrieb nicht erforderlich und wird dafür nicht eingerichtet.

## Validierung

`cd backend; npm.cmd test` führt die synthetischen Regressionstests aus. Zusätzlich vorhanden: echte lokale HTTP-Kopplung, Cloud-HTTP-Auftrag ohne Windows-Dienst, OneDrive-Transport-/Revisionsprüfung, verschlüsselte Tokenablage samt Neustart, OCR auf Bildern und Scan-PDF, authentifizierter Import und manuelle Belegbestätigung. Graph-Protokolltests sind Mocks und werden nicht als echte Cloud-Verbindung ausgegeben.

Der echte Dateikopien-Pilot vom 16.11.2026 erkannte 147 Buchungen über acht Seiten mit bestandener Anzahl- und Saldenkontrolle. Sieben Belege wurden zugeordnet, 51 Buchungen folgten den Ausnahmen ohne Belegpflicht und 89 blieben offen. Acht Scanbelege wurden per OCR gelesen und blieben prüfpflichtig. Bankoriginal und Originalkopie blieben hashidentisch; Markierungen wurden zusätzlich visuell geprüft.

Die direkte OneDrive-Verbindung wurde mit dem ausdrücklich freigegebenen Leserecht am 16.11.2026 real bestätigt: Konto stimmt überein, FIBU-Monatsbasis und E-Post erreichbar. Der vollständige direkte OneDrive-/E-Post-Pilot und das produktive Deployment werden im laufenden Auftrag abschließend verifiziert; der lokale Start allein ist kein Nachweis eines erfolgreichen Deployments.

Der Junction-Test wird in dieser Windows-Sandbox übersprungen, weil sie das Erstellen solcher Verknüpfungen blockiert. Traversal und fremde absolute Pfade sind tatsächlich getestet. Belege maximal 25 MB, OneDrive-Quellen maximal 100 MB je Lauf. OneDrive-Unterordner werden nicht rekursiv als Belege eingelesen. Unbekannte Layouts, OCR-Unsicherheit und fachliche Widersprüche bleiben offen.

Keine Zeitpläne, keine Zahlungen, kein Collmex, kein E-Mail-Versand und kein DATEV-Upload.
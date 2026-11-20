## Private Miet- und Darlehensregeln für AC Immo

Mieternamen und bestätigte Mietverwendungszwecke werden ausschließlich als private Regeln in der geschützten FiBu-Datenbank gespeichert. Die JSON-Regeldatei liegt außerhalb des Repositorys. Die Einstellungen können fehlende Regel-IDs aus einer firmenspezifischen Datei ergänzen; vorhandene Regeln und Anpassungen bleiben erhalten. Der Benutzer prüft den Import vor dem Speichern. Serverseitige Validierung und Versionsprüfung gelten unverändert. Die öffentliche Testsuite verwendet nur synthetische Regeln.

Lokale Prüfung der drei September-Auszüge: 55 Buchungen, alle acht Raiffeisen-Mieteingänge und insgesamt 35 Mieteingänge grün; zwei Darlehensabbuchungen lila. Alle Saldenkontrollen und die Prüfung unveränderter Originaldateien erfolgreich. Negative oder nicht passende Eingänge bleiben von der Mietfreigabe ausgeschlossen.

## Gemeinsame Freigabe AC Immo + Jobübersicht

Die AC-Immo-Erweiterung ist mit der Jobsteuerung auf der Monatsübersicht zusammengeführt. Die Aktivierung erfolgt nach Veröffentlichung unter Einstellungen → FiBu über einen privaten JSON-Import mit ausdrücklicher Freigabe. Der Server übernimmt nur die bestätigte AC-Immo-Wurzel, drei geprüfte Konten und die bestehende Microsoft-Verbindung von TestConsulting; E-Mail bleibt gesperrt. Die serverseitigen Verzeichnisse werden abgeleitet, nicht aus der Datei übernommen. Kontodaten verbleiben in der privaten Datenbank und außerhalb des Git-Repositorys. Anmeldung, CSRF und Same-Origin-Prüfung schützen den Import; erneute Aktivierung überschreibt keine vorhandene Einrichtung. SQLite speichert die Firmenkonfiguration über Jenkins-Neuveröffentlichungen hinweg.

Zusammengeführte Regression: 79 Tests, davon 78 erfolgreich und ein umgebungsbedingt übersprungener Symlink-Test. Browsersteuerung beim Releaseversuch weiterhin nicht erreichbar, deshalb Veröffentlichung nicht als abgeschlossen bestätigt.

## Jobsteuerung auf der Monatsübersicht

Pausieren/Fortsetzen steht direkt am Fortschritt jedes aktiven bzw. unterbrochenen FiBu-Eintrags. Der zusätzliche Button „Jobdetails öffnen →“ führt ausdrücklich zu Umsätzen und Ergebnissen. Nach dem Start bleibt die Übersicht geöffnet. Die Detailansicht hat keine Pausensteuerung; der Zurück-Button verweist auf „FiBu-Monate / Jobsteuerung“. Lokal geprüft, weiterhin nicht veröffentlicht.

## Nachkorrektur Jobansicht / Unterbrechung (nur lokal)

Der DOM-Abgleich erhält Elemente über IDs, Eintrags-/Buchungs-IDs und den PDF-Frame. Der Ergebnisrahmen leert die separat aktualisierte Buchungsliste nicht mehr bei jedem Poll. Neue Ergebnisabsätze können vor der Vorschau erscheinen, ohne den Frame zu ersetzen. Die Jobsteuerung steht oben in der Detailansicht und direkt am Fortschritt in der Übersicht. Unterbrochene Serverläufe unter 100 Prozent können über denselben Job erneut geprüft werden; bestehende verifizierte Ablagen werden wiederverwendet. Vollständig beendete, abgebrochene, abgeschlossene oder durch einen anderen aktiven Job blockierte Läufe werden nicht fortgesetzt.

FiBu-Assets tragen eine gemeinsame Version. Nach einem späteren Serverwechsel weist die API auf eine neue Frontend-Version hin; das Laden bleibt eine bewusste Benutzeraktion und startet/stoppt keinen Job. Übersicht aktualisiert sich auch im Leerlauf, temporäre Pollingfehler werden erneut versucht. Ein vollständiger lokaler Browserlauf prüfte Pause/Fortsetzen bei fortlaufender E-Mail-Verarbeitung mit synthetischen Daten, ohne entfernte PDF-Frames oder Styles. Produktion wurde dabei nur lesend geprüft; kein Deployment.
## AC Immo: mehrere Kontoauszüge pro Monat (lokal vorbereitet, nicht deployed)

Ein Monatsprofil kann mehrere bankPdfPaths speichern; sourceBankNames hält die verifizierte Jobauswahl. Jeder Originalauszug wird anhand seiner eigenen Kopf-IBAN, Kontoinhaber und Zeitraum gegen bankAccounts geprüft. Doppelte Firmenkonten im selben Monat sind gesperrt. Sparkasse verwendet Anzahl-/Saldenkontrolle; Raiffeisen-Druckansichten erhalten eine eigene Saldenabstimmung. Die interne Gesamt-PDF dient der gemeinsamen Prüfung, mit Konto-ID/Label und versetzten Seitenkoordinaten pro Umsatz. Einzel-PDFs werden vor der jeweiligen OneDrive-Aktualisierung auf unveränderten Text und Seitenzahl geprüft. Alle ausgewählten Bankdateien bleiben von Belegimport und Nicht-zugewiesen-Ablage ausgeschlossen.

mailEnabled:false sperrt den Mailimport sowie die Postfachprobe; AC Immo verwendet zunächst ausschließlich OneDrive. microsoftConnectionCompany:tc verwendet die vorhandene Microsoft-Sitzung, während Graph-Dateipfade weiterhin gegen die eigene AC-Immo-Wurzel geprüft werden. Die private Firmenkonfiguration mit den drei geprüften Konten liegt außerhalb des Repositorys. Aktivierung und Deployment sind ausdrücklich noch nicht erfolgt.

## Stabile Anzeige, Pause und Regelübersicht

Die FiBu-Übersicht aktualisiert bestehende DOM-Knoten statt bei jedem Polling die ganze Seite und das Stylesheet auszutauschen. Die Detailansicht erhält PDF-Frame, Fokus und aufgeklappte Bereiche. Serverjobs können über Pausieren/Fortsetzen an sicheren Kontrollpunkten angehalten werden; laufende Dateioperationen werden abgeschlossen. Pausierte Jobs reservieren Firma/Monat weiterhin. Pause bleibt über Dienstneustarts erhalten; beim Fortsetzen nach Neustart werden Quellen im selben Job erneut geprüft und verifizierte Ablagen wiederverwendet. Pausenzeiten zählen nicht zur aktiven Laufzeit. Die Regelübersicht bietet kompakte nummerierte Karten, Farbbadges, Suche und eine dauerhaft erreichbare Speicherleiste.

## Suchbereich (direkter Vormonat)

Neue Serverläufe durchsuchen den gewählten Belegordner und genau den direkten Vormonat, einschließlich Unterverzeichnissen bis acht Ebenen. Die Oberfläche fasst Unterordner unter ihrem Elternordner zusammen und kürzt die Anzeige ab `00. FiBu …`. Vollständige Suchpfade bleiben im Prüfbericht. OneDrive-Arbeitskopien werden pro Lauf getrennt gehalten, damit frühere Suchläufe keine zusätzlichen älteren Monatsordner einschleusen. Das E-Post-Archiv und explizite Sammelquellen bleiben eigenständige Quellen.

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
## Lieferantenportale – gemeinsame Verwaltung je Firma

Unter Einstellungen → Lieferantenportale lassen sich für TestConsulting, AC Immo und weitere aktivierte Firmen getrennte Lieferantenzugänge hinterlegen. Beide angemeldeten Portalbenutzer können sie verwalten. Passwörter und Browserzustände werden nie an den Browser zurückgegeben. Ein leeres Passwort bei einer Änderung behält den bisherigen Wert. Aktivierung und automatische FiBu-Prüfung sind getrennt schaltbar.

Die Zugangsdaten und Cookie-/LocalStorage-Sitzungen liegen AES-256-GCM-verschlüsselt in `fibu_portal_accounts`. Als Schlüssel dient `FIBU_PORTAL_KEY` (32 Bytes Base64), ersatzweise wird der bestehende `FIBU_TOKEN_KEY` über HKDF mit eigenem Kontext abgeleitet. Schlüssel bleiben außerhalb der Datenbank und des Git-Repositories. Datenbank und Schlüssel müssen getrennt gesichert werden. Versionsprüfungen verhindern verlorene Änderungen. Statusmeldungen enthalten keine Passwörter, Codes oder Sitzungsdaten.

Automatischer Ablauf: erst vorhandene OneDrive-/E-Mail-Belege lesen; nur für noch fehlende, belegpflichtige Lieferantenbuchungen aktivierte Portale abrufen; PDF-Inhalt und Prüfsumme prüfen; Import dauerhaft speichern; im selben Lauf dem normalen Belegabgleich zuführen. Portalstatus und Ergebnisse stehen zusätzlich im Suchbereich des Jobs. Ein Download allein markiert keine Buchung gelb. Freigestellte Gutschriften und Ausnahmen ohne Belegpflicht lösen keinen Portalabruf aus.

Einzelabrufe nach Prüfmonat sind in der Portalverwaltung möglich. Einmalcodes werden ausschließlich im Speicher an einen aktuell wartenden Browserprozess weitergegeben. Bei CAPTCHA, Push-Bestätigung, fehlgeschlagener Anmeldung oder abweichender Portalstruktur wird eine erforderliche Interaktion bzw. ein Fehler angezeigt. Kein automatisches Lösen von CAPTCHAs und keine Passwortänderungen. Browserabrufe sind zeitlich begrenzt, abbrechbar und pro Firma/Lieferant gesperrt. Bestehende Sitzungen werden verschlüsselt wiederverwendet.

Der Katalog umfasst Lebara, Urban Sports Club, STRATO, FuelsCard, Microsoft, Amazon, HUK und Sachbezugskarte. Das ist ein konfigurierbarer Browserablauf, keine Zusicherung, dass alle Lieferantenoberflächen unverändert ohne Einrichtung funktionieren. Standardfelder sowie Rechnungslinks werden erkannt; Rechnungsseite und CSS-Auswahlpfade lassen sich pro Zugang ergänzen. Rechnungszeilen müssen den Prüfmonat enthalten (YYYY-MM, MM.YYYY oder MM/YYYY). Andere Layouts, dynamische Downloadbuttons und zusätzliche Authentifizierung müssen mit dem konkreten Lieferantenzugang validiert werden. Echte Zugangsdaten gehören nur in das geschützte Formular.

Der Server startet kurzlebige, isolierte Chromium-Prozesse als Nicht-Root-Benutzer mit Chromium-Sandbox. Domains sind je Lieferant fest freigegeben; private Netzwerkziele, Service Worker und WebSockets werden blockiert. PDF-Downloads sind auf zehn Dateien, 25 MB je Datei und insgesamt 50 MB begrenzt. Docker installiert den zur exakt gepinnten Playwright-Version gehörenden Browser. Compose und Jenkins verwenden das offizielle Playwright-Seccomp-Profil für die benötigten Benutzer-Namensräume. Quelle: https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json (Playwright, Apache-2.0); Hintergrund: https://playwright.dev/docs/docker.

Lokale Prüfung: Vault-, Firmen-/Benutzer-, HTTP-/CSRF-, Import- und vollständiger Engine-Test mit synthetischem Lieferantenbeleg; Oberfläche mit getrenntem lokalen Vorschaukonto geprüft. Der native Chromium-Test ist in der Windows-Codex-Sandbox nicht startbar. Jenkins muss ihn mit `ASTRA_REQUIRE_BROWSER_TEST=1` im Linux-Image ausführen; bei einem Fehler darf nicht deployed werden. Ein Live-Abruf echter Lieferantenrechnungen ist ohne hinterlegte Zugänge noch nicht verifiziert.

### Eigene Lieferanten und Entfernen

Über „+ Portal hinzufügen“ können Benutzer je Firma eigene Lieferanten mit Namen, HTTPS-Anmelde-Adresse und Buchungssuchbegriffen anlegen. Die Suchbegriffe sind auch bei bestehenden Zugängen bearbeitbar. Eigene Portale dürfen nur die ausdrücklich hinterlegten Hosts verwenden; zusätzliche Login-/Download-Hosts sind optional. Ein interner CONNECT-Proxy prüft DNS-Antworten und verbindet sich mit derselben geprüften öffentlichen IP-Adresse, damit selbst definierte Hosts nicht auf interne Dienste umgebunden werden können.

„Entfernen“ blendet Standard- und eigene Portale aus und schaltet gespeicherte Zugänge sowie automatische Abrufe aus. Laufende Abrufe müssen zuvor beendet werden. Bereits importierte Dokumente und die verschlüsselten Zugangsdaten bleiben erhalten. Unter „Entfernte Portale“ ist Wiederherstellung möglich; die Zugänge bleiben anschließend deaktiviert, bis der Benutzer sie wieder freigibt. Änderungen sind je Firma isoliert, für beide Benutzer gemeinsam und gegen konkurrierende Änderungen versioniert. Eigene Portale stehen auch als Quelle beim manuellen Belegimport zur Verfügung. Bis zu 50 aktive Portale je Firma sind möglich.

### Markierungsstand und Portaltest

Die Monatsübersicht zeigt farbig markierte Buchungen als Hauptkennzahl. Grün, Lila und Gelb zählen gleichwertig; der Balken verwendet markiert / alle Buchungen. Offene Buchungen und tatsächliche Belegzuordnungen stehen getrennt darunter. Beispiel: 35 grüne, 2 lila und 2 gelbe Buchungen ergeben 39/55 markiert, 16 offen und 2 mit Beleg zugeordnet.

„Portal aufruf testen“ prüft ausschließlich Portalzugriff und Anmeldung, ohne Rechnung herunterzuladen. Der Rechnungsabruf bleibt Bestandteil des FiBu-Laufs für fehlende Belege. Ein Zeitpunkt „Erfolgreich zuletzt“ wird nur nach nachgewiesener Anmeldung gespeichert. Das bloße Speichern eines Passworts oder ein historischer Durchlauf ohne heruntergeladene Dokumente zählt nicht als Anmeldebestätigung. Fehlerdiagnosen enthalten nur bereinigte Seitenadressen ohne Queryparameter und blockierte Hostnamen/Ressourcentypen, keine Zugangsdaten oder Cookies.

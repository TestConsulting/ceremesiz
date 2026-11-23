# Vertriebspilot

Der Entwicklungsstand ergänzt die geschützte ASTRA-Oberfläche um Master Templates, Projekte/Freigaben und Vertriebskonfig. Die Funktionen sind per standardmäßiger Sitzung und per expliziter E-Mail-Liste geschützt. Das bestehende FiBu-Modul benutzt weiterhin seine eigenen Routen und Daten.

## Start am Entwicklungsrechner

Im Backend die bestehenden lokalen Einstellungen für Session, Host und SQLite beibehalten. Für einen separat gestarteten Pilot auf 127.0.0.1 kann PowerShell die folgenden Einstellungen an den Prozess vererben:

```powershell
$env:PORT = '4090'
$env:SALES_PILOT_USERS = 'astra-dev@example.invalid'
$env:SALES_APPROVER_USERS = 'astra-dev@example.invalid'
npm.cmd run dev
```

Die Adresse lautet http://127.0.0.1:4090. Beide Listen sind kommasepariert. Freigabe erfordert Pilotzugriff und einen Eintrag in der Freigabeliste. Für eine geschützte bereitgestellte Instanz die echten berechtigten Konten und die vorhandene private Konfiguration verwenden. Die Testadresse gehört ausschließlich in die lokale Umgebung. Ohne Pilotliste bleiben die neuen Ansichten ausgeblendet und die API wird nicht eingebunden.

## Ablauf

1. Unter **Master Templates** die Person speichern. Bench und Vertrieb aktivieren. Danach den echten PDF- oder DOCX-Master hochladen. Ein erneuter Upload erzeugt eine neue Version. PDFs werden im Browser angezeigt. Bei DOCX ist die Textvorschau verfügbar, das Original bleibt als Word-Datei erhalten.
2. Unter **Vertriebskonfig** Quellen, Schlagwörter und geplante Suchzeiten speichern. **Quellen prüfen** testet die öffentliche Erreichbarkeit. Die Anzeige unterscheidet diese Prüfung von der Anmeldung und Recherche.
3. In **Projekte/Freigaben** eine echte Originalausschreibung erfassen. Gleiche Quellreferenzen werden wiedererkannt. Ist keine Referenz verfügbar, dient der normalisierte Titel mit dem Originaltext als Vergleich.
4. Karte öffnen und Kandidaten auswählen. Textnachweise werden am Master belegt, offene Anforderungen bleiben sichtbar. Für die fachliche Bewertung den Originalmaster daneben öffnen. Der manuell bearbeitete Projekt-CV ist separat versioniert und steht in Word und PDF zur Verfügung. Die eingebaute PDF-Schrift deckt gängige deutsche Zeichen ab. Ist ein Zeichen nicht abbildbar, meldet der Export dies und das Word-Dokument ist weiterhin verfügbar.
5. Anschreiben, Zielkanal und Empfänger sowie Konditionen je Person speichern. Stundensatz und Starttermin sind Pflicht für die Freigabe. Der Dialog zeigt die konkrete gespeicherte Angebotsversion samt Original, Nachweisen und Dokumenten. Änderungen erzeugen eine neue Revision und heben die Freigabe auf.
6. Das freigegebene Angebot im Portal manuell einreichen. Buchung und Bestätigung der tatsächlichen Einreichung erfolgen im selben Projekt. Nach bestätigter Einreichung ist die Version archiviert. Automatischer Versand ist in diesem Entwicklungsstand nicht aktiv.

## Integrationen

| Integration | Stand |
| --- | --- |
| freelancermap | Öffentliche Projektbörse erreichbar. Recherche im Firmenkonto und Import der Originalausschreibung erfolgen manuell. Die veröffentlichte XML/JSON-Angebotsschnittstelle beschreibt das Einstellen eigener Projekte und belegt keinen Such- oder Exportzugang. Der offiziell dokumentierte Projektagent liefert E-Mail-Benachrichtigungen. |
| Randstad / GULP | Öffentliche Projektbörse erreichbar. Recherche und Einreichung erfolgen manuell über die Portaloberfläche. Offizieller Suchagent per E-Mail vorhanden. Ein Firmenzugang oder eine Suchschnittstelle wurde für diesen Rechner noch nicht verifiziert. |
| sales@testconsulting.de | In dieser Phase zurückgestellt. Keine Postfachfreigabe, keine E-Mail-Verarbeitung und kein Versand. |
| KI-Verarbeitung | Projekt-CVs werden manuell erstellt. Die angemeldete Codex-Instanz ist bislang nicht als Verarbeitungskomponente an das Portal angebunden. |
| Scheduler | Suchzeiten werden gespeichert. Der automatische Scheduler bleibt bis zur autorisierten Quellenanbindung inaktiv. |

## Betrieb und Datensicherung

Mitarbeiter, Originaldokumente und Projekt-CVs liegen vollständig in SQLite. Die bestehende SQLite-Backup-Methode aus der Pipeline erfasst sie ebenfalls. Verwende eine konsistente SQLite-Sicherung statt eine laufende Datenbankdatei ohne WAL zu kopieren. Sicherung und private Umgebungsvariablen außerhalb von Git aufbewahren. Die Entwicklungsdatenbank über DB_PATH von Produktion trennen.

Wenn eine Quellenprüfung während eines Prozessabbruchs offen bleibt, zeigt die Oberfläche sie nach Ablauf des Zeitfensters als unterbrochen an. Der nächste Start schließt den alten Prüflauf ab und legt einen neuen an. Der Job prüft nur feste, öffentliche Adressen der zwei Anbieter und sendet keine Zugangsdaten.

Die Regressionstests unter backend/test/sales-pilot.test.js und backend/test/sales-http.test.js verwenden synthetische Daten und temporäre SQLite-Dateien.

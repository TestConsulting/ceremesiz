# Ceremesiz Holding – Website mit internem Bereich

- `index.html` – öffentliche Website inkl. Login-Dialog
- `backend/` – Node.js/Express-Backend (Login, Sessions, geschützter Bereich `/intern`)
- `backend/private/intern.html` – interner Bereich, wird **nur** nach Login vom Backend ausgeliefert
- `nginx/ceremesiz.conf` – Beispiel-Konfiguration für Nginx (HTTPS → Backend)

Passwörter werden mit bcrypt gehasht in SQLite (`backend/data/`) gespeichert, die Session liegt in einem HttpOnly-Cookie.

Im internen Bereich lassen sich unter **Einstellungen** die Namen und der Beta-Status der Seitenleisten-Einträge und Gruppen sowie eine gemeinsame Beta-Farbe ändern. Die Einstellungen werden für alle Benutzer in SQLite gespeichert; bereits geöffnete Sitzungen zeigen Änderungen nach dem Neuladen. Andere Moduldaten bleiben im jeweiligen Browser gespeichert.

## Lokal starten

```powershell
cd backend
npm install
npm run user:set -- taner.ceremesiz@testconsulting.de Taner Ceremesiz   # fragt das Passwort ab
npm run user:set -- soner.ceremesiz@testconsulting.de Soner Ceremesiz
npm run dev                                                              # http://127.0.0.1:4000
npm test
```

## Server (Linux mit Docker, z. B. Strato V-Server)

Reines Webhosting reicht nicht – es wird ein Server benötigt, auf dem Docker/Node läuft.

```bash
cd /opt && git clone <repo-url> ceremesiz && cd ceremesiz
cp backend/.env.example backend/.env      # SESSION_SECRET setzen!
mkdir -p backend/data && sudo chown 1000:1000 backend/data
docker compose up -d --build

# Benutzer anlegen bzw. Passwort ändern (Passwort wird verdeckt abgefragt)
docker compose exec backend node src/set-user.js taner.ceremesiz@testconsulting.de Taner Ceremesiz
docker compose exec backend node src/set-user.js soner.ceremesiz@testconsulting.de Soner Ceremesiz
```

Nginx: `nginx/ceremesiz.conf` nach `/etc/nginx/conf.d/` kopieren, Domain/Zertifikat anpassen, `sudo nginx -t && sudo systemctl reload nginx`.
Der Container lauscht nur auf `127.0.0.1:4010`.

**Update/Deployment:** `git pull && docker compose up -d --build`

Beim Ändern eines Passworts werden alle bestehenden Sessions des Benutzers beendet.

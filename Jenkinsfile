pipeline {
  agent any
  options { disableConcurrentBuilds() }
  stages {
    stage('Backup und Quellstand') {
      steps {
        sh '''set -eu
cd /var/www/ceremesiz-app
test -z "$(git status --porcelain)"
backup="$PWD/backend/data/deploy-backup-$BUILD_NUMBER"
mkdir -p "$backup"
chmod 700 "$backup"
git rev-parse HEAD > "$backup/commit.txt"
docker compose images -q backend > "$backup/image.txt"
cp -p backend/.env "$backup/backend.env"
if test -f backend/data/fibu.config.json; then cp -p backend/data/fibu.config.json "$backup/fibu.config.json"; fi
docker compose exec -T --user root -e "ASTRA_BACKUP_NAME=deploy-backup-$BUILD_NUMBER" backend node -e 'const D=require("better-sqlite3"),d=new D(process.env.DB_PATH);d.backup("/app/backend/data/"+process.env.ASTRA_BACKUP_NAME+"/ceremesiz.db").then(()=>d.close()).catch(()=>process.exit(1))'
chmod 600 "$backup/ceremesiz.db"
git pull --ff-only origin main
git rev-parse HEAD
'''
      }
    }
    stage('Image und isolierte Tests') {
      steps {
        sh '''set -eu
cd /var/www/ceremesiz-app
docker compose build backend
image="$(docker image inspect --format '{{.Id}}' ceremesiz-app-backend:latest)"
docker run --rm --network none --entrypoint node "$image" --test
'''
      }
    }
    stage('Private FIBU-Konfiguration') {
      steps {
        withCredentials([string(credentialsId: 'astra-fibu-tc-bootstrap', variable: 'ASTRA_FIBU_BOOTSTRAP')]) {
          sh '''set +x
set -eu
cd /var/www/ceremesiz-app
docker compose run --rm --no-deps --user root -e ASTRA_FIBU_BOOTSTRAP -v "$PWD/backend:/configure" backend node /configure/scripts/configure-fibu.cjs
'''
        }
      }
    }
    stage('Deployment und Healthcheck') {
      steps {
        sh '''set -eu
cd /var/www/ceremesiz-app
docker compose up -d --no-build backend
ok=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if docker compose exec -T backend node -e 'fetch("http://127.0.0.1:4000/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'; then ok=1; break; fi
  sleep 3
done
test "$ok" = 1
curl --fail --silent --show-error https://www.ceremesiz-holding.de/health
docker compose ps
'''
      }
    }
  }
  post {
    failure {
      sh '''set +x
set -eu
cd /var/www/ceremesiz-app
backup="$PWD/backend/data/deploy-backup-$BUILD_NUMBER"
if test -s "$backup/image.txt"; then
  if test -f "$backup/backend.env"; then cp -p "$backup/backend.env" backend/.env; fi
  if test -f "$backup/fibu.config.json"; then
    cp -p "$backup/fibu.config.json" backend/data/fibu.config.json
  elif test -f backend/data/fibu.config.json; then
    mv backend/data/fibu.config.json "$backup/failed-fibu.config.json"
  fi
  docker image tag "$(cat "$backup/image.txt")" ceremesiz-app-backend:latest
  docker compose up -d --no-build backend
  echo 'Vorheriges Image und private Konfiguration wiederhergestellt. Datenbank bleibt erhalten.'
fi
'''
    }
  }
}

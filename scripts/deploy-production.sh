#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" != "0" ]]; then
  echo "Executa aquest script amb sudo." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
rollback_image="lleidapeix:rollback-${stamp}"
caddy_backup="/etc/caddy/Caddyfile.pre-lleidapeix-${stamp}"
release_archive="release/lleidapeix-0.4.0-amd64.tar.gz"

docker image inspect lleidapeix:local >/dev/null
docker tag lleidapeix:local "$rollback_image"
cp /etc/caddy/Caddyfile "$caddy_backup"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

mkdir -p data/backups
docker compose exec -T app /app/lleidapeix backup "/app/data/backups/lleidapeix-${stamp}.sqlite"

rollback_app() {
  echo "La versió nova no respon; restaurant la imatge anterior..." >&2
  docker tag "$rollback_image" lleidapeix:local
  docker compose up -d --force-recreate app
}

if [[ -f "$release_archive" ]]; then
  sha256sum -c "$release_archive.sha256"
  echo "Carregant la imatge precompilada de LleidaPeix 0.4.0..."
  gzip -dc "$release_archive" | docker load
  docker image inspect lleidapeix:0.4.0 >/dev/null
  docker tag lleidapeix:0.4.0 lleidapeix:local
else
  echo "No s'ha trobat $release_archive; compilant al servidor..."
  docker compose build app
fi
if ! docker compose up -d app; then
  rollback_app
  exit 1
fi

healthy=false
for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:18085/api/health | grep -q '"version":"0.4.0"'; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "$healthy" != "true" ]]; then
  rollback_app
  exit 1
fi

echo "LleidaPeix 0.4.0 desplegat. Rollback disponible a $rollback_image"
curl -fsS http://127.0.0.1:18085/api/health

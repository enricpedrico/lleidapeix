#!/usr/bin/env bash
set -euo pipefail
[[ "$(id -u)" == "0" ]] || { echo "Executa amb sudo." >&2; exit 1; }
cd "$(dirname "$0")/.."
curl -fsS http://127.0.0.1:18085/api/health | grep -q '"version":"0.4.0"'
grep -q '"frontend":"0.4.2-trump"' web-dist/release.json
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
rollback="lleidapeix:before-trump-${stamp}"
folder="release/trump-backup-${stamp}"
docker tag lleidapeix:local "$rollback"
mkdir -p "$folder" data/backups
docker cp lleidapeix:/app/web-dist "$folder/web-dist"
cp /etc/caddy/Caddyfile "$folder/Caddyfile"
docker compose exec -T app /app/lleidapeix backup "/app/data/backups/before-trump-${stamp}.sqlite"
engine_before="$(docker compose exec -T app sha256sum /app/lleidapeix | cut -d ' ' -f1)"
docker build --build-arg "BACKEND_IMAGE=$rollback" -f Dockerfile.web-release -t lleidapeix:trump-0.4.2 .
rollback_app() {
  docker tag "$rollback" lleidapeix:local
  docker compose up -d --no-build --force-recreate app
}
docker tag lleidapeix:trump-0.4.2 lleidapeix:local
if ! docker compose up -d --no-build --force-recreate app; then rollback_app; exit 1; fi
healthy=false
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:18085/api/health | grep -q '"version":"0.4.0"' && \
      curl -fsS http://127.0.0.1:18085/release.json | grep -q '"frontend":"0.4.2-trump"'; then
    healthy=true
    break
  fi
  sleep 1
done
engine_after="$(docker compose exec -T app sha256sum /app/lleidapeix | cut -d ' ' -f1)"
if [[ "$healthy" != true || "$engine_before" != "$engine_after" ]]; then rollback_app; exit 1; fi
printf 'Trumfo 0.4.2 publicat; motor verificat i intacte: %s\nRollback: %s\nBackup: %s\n' "$engine_after" "$rollback" "$folder"
curl -fsS http://127.0.0.1:18085/release.json

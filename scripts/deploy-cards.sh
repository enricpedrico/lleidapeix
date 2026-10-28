#!/usr/bin/env bash
set -euo pipefail
[[ "$(id -u)" == "0" ]] || { echo "Executa amb sudo." >&2; exit 1; }
cd "$(dirname "$0")/.."
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
rollback="lleidapeix:before-cards-${stamp}"
docker tag lleidapeix:local "$rollback"
mkdir -p "release/cards-backup-${stamp}"
docker cp lleidapeix:/app/web-dist "release/cards-backup-${stamp}/web-dist"
docker compose exec -T app /app/lleidapeix backup "/app/data/backups/before-cards-${stamp}.sqlite"
engine_before="$(docker compose exec -T app sha256sum /app/lleidapeix | cut -d ' ' -f1)"
docker build --build-arg "BACKEND_IMAGE=$rollback" -f Dockerfile.web-release -t lleidapeix:cards-0.4.1 .
rollback_app() {
  docker tag "$rollback" lleidapeix:local
  docker compose up -d --no-build --force-recreate app
}
docker tag lleidapeix:cards-0.4.1 lleidapeix:local
if ! docker compose up -d --no-build --force-recreate app; then
  rollback_app
  exit 1
fi
healthy=false
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:18085/api/health >/dev/null && \
      curl -fsS http://127.0.0.1:18085/release.json | grep -q '"frontend":"0.4.1-cards"'; then
    healthy=true
    break
  fi
  sleep 1
done
engine_after="$(docker compose exec -T app sha256sum /app/lleidapeix | cut -d ' ' -f1)"
if [[ "$healthy" != true || "$engine_before" != "$engine_after" ]]; then
  rollback_app
  exit 1
fi
printf 'Cartes 0.4.1 publicades; motor intacte. Rollback: %s\n' "$rollback"
curl -fsS http://127.0.0.1:18085/release.json

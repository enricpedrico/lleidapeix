#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p data/backups
if [[ "$(id -u)" == "0" ]]; then
  chown 1000:1000 data/backups
fi
docker compose exec -T app /app/lleidapeix backup "/app/data/backups/lleidapeix-${stamp}.sqlite"
find data/backups -type f -name 'lleidapeix-*.sqlite' -printf '%T@ %p\n' \
  | sort -rn \
  | awk 'NR > 30 { sub(/^[^ ]+ /, ""); print }' \
  | xargs -r rm --

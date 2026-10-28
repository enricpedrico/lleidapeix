#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Ús: $0 data/backups/lleidapeix-YYYYMMDDTHHMMSSZ.sqlite" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
docker compose stop app
cp -a data/lleidapeix.sqlite "data/lleidapeix.sqlite.pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
cp "$1" data/lleidapeix.sqlite
rm -f data/lleidapeix.sqlite-wal data/lleidapeix.sqlite-shm
docker compose up -d app

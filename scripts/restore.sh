#!/usr/bin/env bash
# Restores a backup over the current database:
#   ./scripts/restore.sh backups/budget-20261004-020000.dump
set -euo pipefail
cd "$(dirname "$0")/.."

file="${1:-}"
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Usage: $0 backups/<file>.dump" >&2
  exit 2
fi

env_value() {
  local key="$1" default="$2" line
  line=$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 || true)
  line="${line#*=}"
  line="${line%%#*}"
  line="$(echo "$line" | xargs)"
  echo "${line:-$default}"
}
DB=$(env_value POSTGRES_DB budget)
USER_NAME=$(env_value POSTGRES_USER budget)

echo "This replaces ALL data in database '$DB' with the contents of:"
echo "  $file"
read -r -p "Type RESTORE to continue: " answer
if [ "$answer" != "RESTORE" ]; then
  echo "Cancelled."
  exit 1
fi

docker compose up -d postgres
docker compose stop backend
restart_backend() { docker compose start backend >/dev/null || true; }
trap restart_backend EXIT

docker compose exec -T postgres pg_restore --clean --if-exists --no-owner --exit-on-error -U "$USER_NAME" -d "$DB" < "$file"
echo "Restore complete. Starting the backend (it applies any newer migrations)."

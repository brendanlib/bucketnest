#!/usr/bin/env bash
# Writes backups/budget-YYYYMMDD-HHMMSS.dump (pg_dump custom format, mode 600)
# and keeps the newest BACKUP_RETENTION files. Exits non-zero on failure.
#   cron: 0 2 * * * cd /opt/home-budget && ./scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

env_value() {
  # Reads KEY=value from .env without executing it; strips inline comments and quotes.
  local key="$1" default="$2" line
  line=$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 || true)
  line="${line#*=}"
  line="${line%%#*}"
  line="$(echo "$line" | xargs)"
  echo "${line:-$default}"
}

DB=$(env_value POSTGRES_DB budget)
USER_NAME=$(env_value POSTGRES_USER budget)
RETENTION=$(env_value BACKUP_RETENTION 14)

umask 077
mkdir -p backups
chmod 700 backups
file="backups/budget-$(date +%Y%m%d-%H%M%S).dump"
tmp="${file}.partial"
trap 'rm -f "$tmp"' EXIT

docker compose exec -T postgres pg_dump -U "$USER_NAME" -d "$DB" -Fc > "$tmp"
if [ ! -s "$tmp" ]; then
  echo "Backup failed: dump is empty" >&2
  exit 1
fi
mv "$tmp" "$file"
chmod 600 "$file"
trap - EXIT
echo "Backup written: $file ($(du -h "$file" | cut -f1))"

# Retention: delete everything older than the newest $RETENTION backups.
count=0
for old in $(ls -1t backups/budget-*.dump 2>/dev/null); do
  count=$((count + 1))
  if [ "$count" -gt "$RETENTION" ]; then
    rm -f -- "$old"
    echo "Removed old backup: $old"
  fi
done

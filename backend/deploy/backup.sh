#!/usr/bin/env bash
# Daily database backup, kept for 14 days. Uses DATABASE_URL from backend/.env, and the server's
# pg_dump (or the PostgreSQL container's).
# Run from cron, e.g.:
#   30 2 * * * /opt/rite-exam-portal/backend/deploy/backup.sh >> /opt/rite-exam-portal/backend/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."   # the backend folder: .env and backups/ live there
# PostgreSQL.org packages put pg_dump outside cron's PATH; prefer the newest one installed.
for dir in /usr/pgsql-17/bin /usr/pgsql-16/bin /usr/pgsql-15/bin; do
  if [ -x "$dir/pg_dump" ]; then PATH="$dir:$PATH"; break; fi
done

mkdir -p backups
file="backups/exam-$(date +%Y-%m-%d-%H%M).sql.gz"
url="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r"')"

# PostgreSQL running in a Docker container: use that container's own pg_dump (always the right version).
# Set PG_CONTAINER=<name> in .env, or it is found automatically when this server has no pg_dump.
container="$(grep -E '^PG_CONTAINER=' .env | cut -d= -f2- | tr -d '\r"' || true)"
if [ -z "$container" ] && ! command -v pg_dump >/dev/null && command -v docker >/dev/null; then
  container="$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /^postgres/ {print $1; exit}')"
fi
if [ -n "$container" ]; then
  dump() { docker exec "$container" pg_dump --no-owner "$url"; }  # 127.0.0.1 inside the container is that PostgreSQL
else
  dump() { pg_dump --no-owner "$url"; }
fi

if ! dump | gzip > "$file"; then
  rm -f "$file"
  echo "$(date '+%F %T') BACKUP FAILED (see the error above)" >&2
  exit 1
fi
find backups -name 'exam-*.sql.gz' -mtime +14 -delete
# Keep the log small
if [ -f backups/backup.log ] && [ "$(stat -c %s backups/backup.log)" -gt 10485760 ]; then : > backups/backup.log; fi
echo "$(date '+%F %T') backup written: $file ($(du -h "$file" | cut -f1))"

# Restore a backup into an EMPTY database (replaces nothing; ask before restoring over live data):
#   gunzip -c backups/<file>.sql.gz | psql "<DATABASE_URL>"
#   PostgreSQL in a container:  gunzip -c backups/<file>.sql.gz | docker exec -i <container> psql "<DATABASE_URL>"

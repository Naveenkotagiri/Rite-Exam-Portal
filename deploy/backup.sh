#!/usr/bin/env bash
# Daily database backup, kept for 14 days. Uses DATABASE_URL from deploy/.env and the server's pg_dump.
# Run from cron, e.g.:
#   30 2 * * * /opt/rite-exam-portal/deploy/backup.sh >> /opt/rite-exam-portal/deploy/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
# PostgreSQL.org packages put pg_dump outside cron's PATH; prefer the newest one installed.
for dir in /usr/pgsql-17/bin /usr/pgsql-16/bin /usr/pgsql-15/bin; do
  if [ -x "$dir/pg_dump" ]; then PATH="$dir:$PATH"; break; fi
done

mkdir -p backups
file="backups/exam-$(date +%Y-%m-%d-%H%M).sql.gz"
url="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r"')"

if ! pg_dump --no-owner "$url" | gzip > "$file"; then
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

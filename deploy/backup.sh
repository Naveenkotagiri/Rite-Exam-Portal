#!/usr/bin/env sh
# Daily database backup, kept for 14 days. Uses DATABASE_URL from deploy/.env and the server's pg_dump.
# Run from cron, e.g.:
#   30 2 * * * /opt/rite-exam-portal/deploy/backup.sh >> /opt/rite-exam-portal/deploy/backups/backup.log 2>&1
set -eu
cd "$(dirname "$0")"
mkdir -p backups
file="backups/exam-$(date +%Y-%m-%d-%H%M).sql.gz"
url="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"

pg_dump --no-owner "$url" | gzip > "$file"
find backups -name 'exam-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') backup written: $file ($(du -h "$file" | cut -f1))"

# Restore a backup into an EMPTY database (replaces nothing; ask before restoring over live data):
#   gunzip -c backups/<file>.sql.gz | psql "<DATABASE_URL>"

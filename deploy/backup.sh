#!/usr/bin/env sh
# Daily database backup, kept for 14 days. Works with your own PostgreSQL server (DATABASE_URL in .env)
# or the local-db container. Run from cron, e.g.:
#   30 2 * * * /opt/rite-exam-portal/deploy/backup.sh >> /var/log/rite-exam-backup.log 2>&1
set -eu
cd "$(dirname "$0")"
mkdir -p backups
file="backups/exam-$(date +%Y-%m-%d-%H%M).sql.gz"
url="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- || true)"

if [ -n "$url" ]; then
  # pg_dump from a throwaway PostgreSQL container, so nothing has to be installed on this server
  docker run --rm --network host postgres:16-alpine pg_dump --no-owner "$url" | gzip > "$file"
else
  docker compose -f docker-compose.prod.yml exec -T db pg_dump -U exam --no-owner exam | gzip > "$file"
fi
find backups -name 'exam-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') backup written: $file ($(du -h "$file" | cut -f1))"

# Restore a backup into an EMPTY database (replaces nothing; ask before restoring over live data):
#   own server:  gunzip -c backups/<file>.sql.gz | docker run --rm -i --network host postgres:16-alpine psql "<DATABASE_URL>"
#   local-db:    gunzip -c backups/<file>.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U exam exam

#!/usr/bin/env sh
# Daily database backup, kept for 14 days. Run from cron, e.g.:
#   30 2 * * * /opt/rite-exam-portal/deploy/backup.sh >> /var/log/rite-exam-backup.log 2>&1
set -eu
cd "$(dirname "$0")"
mkdir -p backups
file="backups/exam-$(date +%Y-%m-%d-%H%M).sql.gz"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U exam --no-owner exam | gzip > "$file"
find backups -name 'exam-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') backup written: $file ($(du -h "$file" | cut -f1))"

# Restore a backup (stops nothing; replaces the data):
#   gunzip -c backups/exam-YYYY-MM-DD-HHMM.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U exam exam

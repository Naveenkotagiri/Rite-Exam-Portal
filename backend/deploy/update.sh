#!/usr/bin/env bash
# Installs the latest backend from Git and restarts the service. Run as opc:
#   /opt/rite-exam-portal/backend/deploy/update.sh
# Never run it while a campus drive is in progress: the restart interrupts students.
set -euo pipefail
cd "$(dirname "$0")/.."   # the backend folder

git pull --ff-only
.venv/bin/pip install -q -r requirements.txt
sudo install -m 644 deploy/rite-exam-portal.service /etc/systemd/system/rite-exam-portal.service
sudo systemctl daemon-reload
sudo systemctl restart rite-exam-portal

setting() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '\r" ' || true; }
url="http://$(setting HOST | sed 's/^$/127.0.0.1/'):$(setting PORT | sed 's/^$/8085/')/api/health"
for _ in $(seq 1 30); do
  if curl -fsS "$url" >/dev/null 2>&1; then
    echo "Backend updated and running ($url)."
    exit 0
  fi
  sleep 2
done
echo "The backend did not come back. See: sudo journalctl -u rite-exam-portal -n 100 --no-pager" >&2
exit 1

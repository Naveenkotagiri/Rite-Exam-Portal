#!/usr/bin/env sh
# Installs the latest version from Git and restarts the portal. Run as the user that owns /opt/rite-exam-portal:
#   /opt/rite-exam-portal/deploy/update.sh
# Never run it while a campus drive is in progress: the restart interrupts students.
set -eu
cd "$(dirname "$0")/.."

git pull --ff-only
npm ci --ignore-scripts --no-audit --no-fund
npm run build
backend/.venv/bin/pip install -q -r backend/requirements.txt

sudo systemctl restart rite-exam-portal
port="$(grep -E '^PORT=' deploy/.env | cut -d= -f2 || true)"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${port:-8085}/api/health" >/dev/null 2>&1; then
    echo "Portal updated and running."
    exit 0
  fi
  sleep 2
done
echo "The portal did not come back. See: sudo journalctl -u rite-exam-portal -n 100" >&2
exit 1

#!/usr/bin/env bash
# Installs the latest version from Git and restarts the portal. Run as opc (the user that owns /opt/rite-exam-portal):
#   /opt/rite-exam-portal/deploy/update.sh
# Never run it while a campus drive is in progress: the restart interrupts students.
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
unset NODE_ENV  # the website build tools are devDependencies
npm ci --ignore-scripts --no-audit --no-fund
# Build into a new folder and swap it in, so the running portal never serves a half-built website.
npx vite build --outDir ../dist.new --emptyOutDir
rm -rf dist.old
if [ -d dist ]; then mv dist dist.old; fi
mv dist.new dist
rm -rf dist.old
backend/.venv/bin/pip install -q -r backend/requirements.txt

sudo install -m 644 deploy/rite-exam-portal.service /etc/systemd/system/rite-exam-portal.service
sudo systemctl daemon-reload
sudo systemctl restart rite-exam-portal
port="$(grep -E '^PORT=' deploy/.env | cut -d= -f2- | tr -d '\r" ' || true)"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${port:-8085}/api/health" >/dev/null 2>&1; then
    echo "Portal updated and running."
    exit 0
  fi
  sleep 2
done
echo "The portal did not come back. See: sudo journalctl -u rite-exam-portal -n 100 --no-pager" >&2
exit 1

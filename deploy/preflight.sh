#!/usr/bin/env bash
# Checks this server for everything the Rite Exam Portal needs and lists every problem at once.
# Run as opc, any time (it changes nothing):   /opt/rite-exam-portal/deploy/preflight.sh
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/deploy/.env"
fails=0; warns=0
ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; warns=$((warns + 1)); }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fails=$((fails + 1)); }
env_value() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' ; }

echo "Code and tools"
[ "$ROOT" = "/opt/rite-exam-portal" ] && ok "code is in /opt/rite-exam-portal" \
  || fail "code is in $ROOT; it must be a git clone in /opt/rite-exam-portal (DEPLOY.md Step 3)"
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 && ok "git checkout ($(git -C "$ROOT" log -1 --format='%h %cs'))" \
  || fail "not a git checkout (a ZIP download cannot be updated); use git clone (Step 3)"
node_major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
if [ -z "$node_major" ]; then fail "Node.js not found (Step 2)"
elif [ "$node_major" -lt 22 ]; then fail "Node.js $(node -v) is too old; need v22+ (Step 2). Found: $(which -a node | tr '\n' ' ')"
else ok "Node.js $(node -v)"; fi
command -v python3.12 >/dev/null && ok "$(python3.12 --version)" || fail "python3.12 not found (Step 2)"
[ -x backend/.venv/bin/python ] && ok "Python environment backend/.venv" || fail "backend/.venv missing (Step 5)"
[ -f dist/index.html ] && ok "website built (dist/)" || fail "website not built: dist/index.html missing (Step 5)"

echo "Settings (deploy/.env)"
if [ ! -f "$ENV_FILE" ]; then
  fail "deploy/.env missing (Step 4)"
else
  ok "deploy/.env exists"
  [ "$(stat -c %a "$ENV_FILE")" = "600" ] || warn "deploy/.env should be private: chmod 600 deploy/.env"
  grep -q $'\r' "$ENV_FILE" && fail "deploy/.env has Windows line endings; fix: sed -i 's/\\r\$//' deploy/.env"
  grep -qE '^APP_PORT=' "$ENV_FILE" && fail "deploy/.env has APP_PORT; rename it to PORT"
  port="$(env_value PORT)"
  [ -n "$port" ] && ok "PORT=$port" || fail "PORT is missing (e.g. PORT=8085)"
  url="$(env_value DATABASE_URL)"
  if [ -z "$url" ]; then fail "DATABASE_URL is missing"
  else
    host="$(sed -E 's#^[a-z+]+://[^@]*@([^:/]+).*#\1#' <<<"$url")"
    case "$host" in
      127.0.0.1|localhost) ok "DATABASE_URL points to $host" ;;
      *) warn "DATABASE_URL points to $host; if PostgreSQL runs on THIS server, use 127.0.0.1 (the public IP times out)" ;;
    esac
  fi
  secret="$(env_value JWT_SECRET)"
  [ "${#secret}" -ge 32 ] && ok "JWT_SECRET is set" || fail "JWT_SECRET missing or short; generate: openssl rand -hex 32"
  [ -n "$(env_value ADMIN_EMAIL)" ] || warn "ADMIN_EMAIL is empty (fine once an admin exists)"
  grep -nE '^[A-Z_]+=.*[[:space:]]#' "$ENV_FILE" >/dev/null && warn "a line in deploy/.env has a '# comment' after the value; systemd keeps it as part of the value"
fi
[ -e "$ROOT/.env" ] && fail "$ROOT/.env exists; delete it (settings belong only in deploy/.env)"

echo "Database"
if [ -x backend/.venv/bin/python ] && [ -n "${url:-}" ]; then
  if out="$(cd backend && DATABASE_URL="$url" DATABASE_SSL="$(env_value DATABASE_SSL)" timeout 20 .venv/bin/python - 2>&1 <<'PY'
import asyncio, asyncpg
from app.db import _dsn, _ssl
async def main():
    c = await asyncpg.connect(_dsn(), ssl=_ssl(), timeout=10)
    v = await c.fetchval("SHOW server_version")
    owner = await c.fetchval("SELECT pg_get_userbyid(datdba) = current_user FROM pg_database WHERE datname = current_database()")
    await c.close()
    print(v, owner)
asyncio.run(main())
PY
  )"; then
    ok "connected to PostgreSQL $(cut -d' ' -f1 <<<"$out")"
    [ "$(cut -d' ' -f2 <<<"$out")" = "True" ] || warn "the database user does not own the database; on PostgreSQL 15+ the first start fails with 'permission denied for schema public' (checklist item 6)"
  else
    fail "cannot connect with DATABASE_URL: $(tail -1 <<<"$out")"
  fi
else
  warn "database check skipped (needs backend/.venv and DATABASE_URL)"
fi

echo "Service"
if [ -f /etc/systemd/system/rite-exam-portal.service ]; then
  ok "service installed"
  systemctl is-active --quiet rite-exam-portal && ok "service running" || warn "service not running: sudo systemctl start rite-exam-portal"
  if curl -fsS "http://127.0.0.1:${port:-8085}/api/health" >/dev/null 2>&1; then ok "portal answers on 127.0.0.1:${port:-8085}"
  else fail "portal does not answer on 127.0.0.1:${port:-8085}; see: sudo journalctl -u rite-exam-portal -n 50 --no-pager"; fi
else
  warn "service not installed yet (Step 6)"
  ss -ltn 2>/dev/null | grep -q ":${port:-8085} " && fail "port ${port:-8085} is already used by another program"
fi
if command -v getenforce >/dev/null && [ "$(getenforce)" = "Enforcing" ]; then
  ls -Zd backend/.venv 2>/dev/null | grep -q user_home_t && fail "files carry a home-folder SELinux label; fix: sudo restorecon -Rv /opt/rite-exam-portal"
  [ "$(getsebool httpd_can_network_connect 2>/dev/null | awk '{print $3}')" = "on" ] && ok "SELinux lets nginx reach the portal" \
    || fail "SELinux blocks nginx → portal (502); fix: sudo setsebool -P httpd_can_network_connect 1"
fi

echo "nginx and firewall"
NGINX="$(command -v nginx || echo /usr/sbin/nginx)"
if [ -x "$NGINX" ]; then
  if sudo -n "$NGINX" -t >/dev/null 2>&1; then ok "nginx configuration is valid"; else fail "sudo nginx -t fails; run it to see why"; fi
  grep -rqs "http2 on;" /etc/nginx/ && [ "$("$NGINX" -v 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1 | tr -d .)" -lt 125 ] \
    && fail "nginx config uses 'http2 on;' which this nginx does not support; use 'listen 443 ssl http2;'"
  grep -rqs "127.0.0.1:${port:-8085}" /etc/nginx/ && ok "nginx forwards to 127.0.0.1:${port:-8085}" \
    || warn "no nginx site forwards to 127.0.0.1:${port:-8085} (Step 7)"
else
  fail "nginx not installed"
fi
if command -v firewall-cmd >/dev/null && sudo -n firewall-cmd --state >/dev/null 2>&1; then
  services="$(sudo -n firewall-cmd --list-services 2>/dev/null)"
  grep -qw https <<<"$services" && grep -qw http <<<"$services" && ok "server firewall allows http and https" \
    || fail "server firewall blocks web traffic; fix: sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload"
fi
echo "  (OCI Security List / NSG rules for ports 80 and 443 cannot be checked from here; see Step 8.)"

echo
if [ "$fails" -eq 0 ]; then printf '\033[32mAll checks passed\033[0m (%d warnings).\n' "$warns"; else printf '\033[31m%d problem(s)\033[0m, %d warning(s). Fix the FAIL lines above.\n' "$fails" "$warns"; fi
exit $((fails > 0))

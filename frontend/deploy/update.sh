#!/usr/bin/env bash
# Builds the website from this Git checkout and puts it into the nginx container. Run as opc:
#   /opt/rite-exam-portal/frontend/deploy/update.sh
# Used for the first install too. Settings (optional): NGINX_CONTAINER (default nginx),
# WEB_ROOT (default /usr/share/nginx/html/Examport).
set -euo pipefail
cd "$(dirname "$0")/.."   # the frontend folder
container="${NGINX_CONTAINER:-nginx}"
web_root="${WEB_ROOT:-/usr/share/nginx/html/Examport}"

git pull --ff-only
unset NODE_ENV   # the build tools are devDependencies
npm ci --ignore-scripts --no-audit --no-fund
npm run build

# Copy next to the live folder, then swap, so visitors never get a half-copied website.
docker exec "$container" sh -c "rm -rf '$web_root.new' && mkdir -p '$web_root.new'"
docker cp dist/. "$container:$web_root.new/"
docker exec "$container" sh -c "rm -rf '$web_root.old'; if [ -d '$web_root' ]; then mv '$web_root' '$web_root.old'; fi; mv '$web_root.new' '$web_root' && rm -rf '$web_root.old'"

echo "Website installed in container '$container' at $web_root:"
docker exec "$container" ls "$web_root"

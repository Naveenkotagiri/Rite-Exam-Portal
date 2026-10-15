# Rite Exam Portal – Frontend

The website: React 19 + Vite. Students register and take the test; admins manage exams, drives, the live monitor
and results. It talks to the backend only through `/api/...` on the **same domain**, so the built files work
anywhere nginx forwards `/api` to the backend.

```
frontend/
├── index.html, vite.config.js, package.json, package-lock.json
├── public/brand/            logos and favicon (copied into the build as-is)
├── src/
│   ├── main.jsx             routes: /, /d/<code> (students), /admin (admins)
│   ├── api.js               every call to the backend
│   ├── student/             register, instructions, test page, proctoring (camera, tab switches), result
│   ├── admin/               login, exams, drives, live monitor, results
│   ├── shared/validation.js registration rules (same as backend/app/core/validation.py)
│   ├── rite/                Rite design tokens (colours, type, spacing)
│   └── ui.jsx, styles.css   shared components and styles
└── deploy/
    ├── nginx/rite-exam-portal.conf          nginx site: serves the website, forwards /api to the backend
    ├── nginx/rite-exam-portal-headers.inc   security headers (incl. camera permission)
    └── update.sh                            build + copy into the nginx container
```

## Develop

Needs Node.js 22+. The backend must be running on port 3000 (see `../backend/README.md`, or run `npm run dev`
in the project folder to start both).
```bash
npm install
npm run dev          # http://localhost:5173 ; /api is forwarded to http://localhost:3000
```

## Build

```bash
npm ci
npm run build        # → dist/  (index.html, assets/ with one .js and one .css, brand/)
```

## Deploy (server: nginx in the Docker container `nginx`)

Install the backend first (`../backend/README.md`): the site forwards `/api` to it at `172.17.0.1:8085`.
The full step-by-step guide is `../DEPLOY.md`; in short, as `opc` on the server:

**First time – nginx site and headers:**
```bash
cd /opt/rite-exam-portal/frontend
docker exec nginx ls -l /etc/pki/tls/certs/        # the certificate paths in deploy/nginx/rite-exam-portal.conf must exist
docker cp deploy/nginx/rite-exam-portal-headers.inc nginx:/etc/nginx/rite-exam-portal-headers.inc
docker cp deploy/nginx/rite-exam-portal.conf nginx:/etc/nginx/conf.d/rite-exam-portal.conf
```

**First time and every update – build and install the website:**
```bash
/opt/rite-exam-portal/frontend/deploy/update.sh
docker exec nginx nginx -t && docker exec nginx nginx -s reload
```

**Check:**
```bash
curl -sk --resolve campus-hire.rite.digital:443:127.0.0.1 https://campus-hire.rite.digital/ | grep -o 'assets/index-[^"]*'
curl -sk --resolve campus-hire.rite.digital:443:127.0.0.1 https://campus-hire.rite.digital/api/health
```
✅ The `.js`/`.css` file names, then `{"ok":true}`.

Never update during a live campus drive.

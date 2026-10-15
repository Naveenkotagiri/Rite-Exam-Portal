# Rite Exam Portal – Deployment Guide

Puts the portal live on the Oracle Cloud (OCI) server where **nginx** and **PostgreSQL** already run as Docker
containers (`nginx`, `postgres-service`). About 30 minutes; every command can be copied and pasted.
Run everything as **`opc`**. After each step there is a ✅ check: if it fails, fix it before going on.

The repository has two self-contained folders, installed separately:

| Folder | What it is | How it runs on the server |
|---|---|---|
| `backend/` | The API (Python) | systemd service `rite-exam-portal` on `172.17.0.1:8085` |
| `frontend/` | The website (React, built to plain files) | static files inside the `nginx` container at `/usr/share/nginx/html/Examport` |

```
Browser ──HTTPS 443──▶ nginx container ─┬─ /, /admin, /assets/ …  → website files (frontend)
                                        └─ /api/…                 → 172.17.0.1:8085 backend service
                                                                       │
                                                                       ▼
                                                     PostgreSQL container (127.0.0.1:5432), database "rite_exam"
```
Only ports **80 and 443** are open to the internet. 8085 and 5432 stay inside the server.

---

## Before you start – checklist

| # | Must be ready | How to check |
|---|---|---|
| 1 | Containers `nginx` and `postgres-service` running | `docker ps` lists both |
| 2 | DNS: `campus-hire.rite.digital` → the server's public IP | `nslookup campus-hire.rite.digital` |
| 3 | OCI Security List / NSG: ingress **TCP 80 and 443** from `0.0.0.0/0` | Networking → VCN → Security Lists |
| 4 | OCI does **not** allow 5432 or 8085 from the internet | same place |
| 5 | Port 8085 free | `sudo ss -ltnp \| grep 8085` shows nothing |

---

## Step 1 – Tools: Git, Python 3.12, Node.js 22

Python runs the backend; Node.js only builds the website.
```bash
sudo dnf install -y git python3.12 python3.12-pip
sudo dnf module reset -y nodejs
sudo dnf module install -y nodejs:22
hash -r
```
If `nodejs:22` is not found: `sudo dnf module disable -y nodejs && curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs && hash -r`

✅ `python3.12 --version` → 3.12.x and `node --version` → **v22.x**

## Step 2 – Get the code

```bash
sudo mkdir -p /opt/rite-exam-portal && sudo chown opc: /opt/rite-exam-portal
git clone https://github.com/Naveenkotagiri/Rite-Exam-Portal.git /opt/rite-exam-portal
```
(Already cloned earlier? `cd /opt/rite-exam-portal && git pull` instead.)
If GitHub asks for a password, use a personal access token.

✅ `ls /opt/rite-exam-portal` shows `backend  frontend  DEPLOY.md …`

## Step 3 – Database (once)

```bash
docker exec -it postgres-service psql -U postgres
```
```sql
CREATE USER rite_exam WITH PASSWORD 'ChooseAStrongPassword123';
CREATE DATABASE rite_exam OWNER rite_exam;
\q
```
Letters and digits only in the password. Skip a line that says "already exists". The database must be **owned**
by `rite_exam`, or the first start fails with "permission denied for schema public".

---

# Part A – Backend

## Step 4 – Install

```bash
cd /opt/rite-exam-portal/backend
python3.12 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
```
✅ Finishes without a red `ERROR`.

## Step 5 – Settings

```bash
cd /opt/rite-exam-portal/backend
cp deploy/.env.prod.example .env
nano .env
```
Fill in (the template explains every line):
```
HOST=172.17.0.1
PORT=8085
FORWARDED_ALLOW_IPS=172.17.0.0/16
DATABASE_URL=postgres://rite_exam:ChooseAStrongPassword123@127.0.0.1:5432/rite_exam
DATABASE_SSL=false
PG_CONTAINER=postgres-service
JWT_SECRET=<paste the output of: openssl rand -hex 32>
ADMIN_NAME=Administrator
ADMIN_EMAIL=<admin>@rite.digital
ADMIN_PASSWORD=<strong password>
WEB_CONCURRENCY=4
```
`DATABASE_URL` uses **127.0.0.1**, never the public IP. Then:
```bash
sed -i 's/\r$//' .env
chmod 600 .env
```

## Step 6 – Start the backend service

```bash
sudo useradd --system --no-create-home --shell /sbin/nologin rite-exam 2>/dev/null
sudo restorecon -R /opt/rite-exam-portal
sudo install -m 644 /opt/rite-exam-portal/backend/deploy/rite-exam-portal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rite-exam-portal
sleep 10
curl http://172.17.0.1:8085/api/health
docker exec nginx sh -c 'curl -s http://172.17.0.1:8085/api/health || wget -qO- http://172.17.0.1:8085/api/health'
```
✅ Both print `{"ok":true}` (the first from the server, the second from inside the nginx container).
- First one fails → `sudo journalctl -u rite-exam-portal -n 50 --no-pager` shows why (see "If something goes wrong").
- Only the second hangs → the firewall blocks containers:
  `sudo firewall-cmd --permanent --zone=trusted --add-interface=docker0 && sudo firewall-cmd --reload`, then repeat it.

The service starts by itself after a reboot and restarts by itself after a crash.

---

# Part B – Frontend

## Step 7 – nginx site (first time only)

The nginx container has no mounted folders, so files are copied in with `docker cp`.
```bash
cd /opt/rite-exam-portal/frontend
docker exec nginx ls -l /etc/pki/tls/certs/
docker exec nginx sh -c 'grep -l campus-hire /etc/nginx/conf.d/*.conf'
```
- The first command must list the certificate files named in `deploy/nginx/rite-exam-portal.conf`
  (`generic.rite.digital.crt` / `.key`). Different names or folder? Edit those two lines in that file first.
- If the second command prints a file **other than** `rite-exam-portal.conf`, an older site for the same domain
  exists: remove it (`docker exec nginx rm /etc/nginx/conf.d/<that file>`).

```bash
docker cp deploy/nginx/rite-exam-portal-headers.inc nginx:/etc/nginx/rite-exam-portal-headers.inc
docker cp deploy/nginx/rite-exam-portal.conf nginx:/etc/nginx/conf.d/rite-exam-portal.conf
```

## Step 8 – Build and install the website

```bash
/opt/rite-exam-portal/frontend/deploy/update.sh
docker exec nginx nginx -t && docker exec nginx nginx -s reload
```
✅ The script ends by listing `assets  brand  index.html`, and `nginx -t` says `syntax is ok` / `test is successful`.

## Step 9 – Check everything

On the server (works even before the OCI ports are open):
```bash
curl -sk --resolve campus-hire.rite.digital:443:127.0.0.1 https://campus-hire.rite.digital/ | grep -o 'assets/index-[^"]*'
curl -sk --resolve campus-hire.rite.digital:443:127.0.0.1 https://campus-hire.rite.digital/api/health
```
✅ The `.js` and `.css` file names, then `{"ok":true}`.

In a browser (needs checklist item 3):

| Open | Expected |
|---|---|
| `https://campus-hire.rite.digital/api/health` | `{"ok":true}` and a padlock |
| `https://campus-hire.rite.digital/admin` | Admin login. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `backend/.env` |

From your own computer, `Test-NetConnection campus-hire.rite.digital -Port 443` (PowerShell) must show
`TcpTestSucceeded : True`; if not, the OCI rules (checklist item 3) are missing.

## Step 10 – Daily backups

```bash
/opt/rite-exam-portal/backend/deploy/backup.sh          # test run: prints "backup written: ..."
(crontab -l 2>/dev/null; echo "30 2 * * * /opt/rite-exam-portal/backend/deploy/backup.sh >> /opt/rite-exam-portal/backend/backups/backup.log 2>&1") | crontab -
```
Backups go to `/opt/rite-exam-portal/backend/backups/` (kept 14 days), made with the PostgreSQL container's own `pg_dump`.

## Step 11 (recommended) – Rehearse a drive with 100 students

About 3 minutes. Creates its own test drive, runs 100 simulated students at once (tab switchers, time-ups,
device switches …), checks every score and rule, prints response times, then deletes the test drive.
Never run it during a real drive.
```bash
cd /opt/rite-exam-portal
backend/.venv/bin/pip install -q httpx
ADMIN_EMAIL='<admin email>' ADMIN_PASSWORD='<admin password>' backend/.venv/bin/python test/load/exam_simulation.py http://172.17.0.1:8085
```
✅ Ends with `Checks: … passed, 0 failed`.

---

## Everyday tasks

| Task | Command |
|---|---|
| Backend running? | `curl http://172.17.0.1:8085/api/health` |
| Backend log | `sudo journalctl -u rite-exam-portal -f` |
| Restart backend (e.g. after editing `backend/.env`) | `sudo systemctl restart rite-exam-portal` |
| Update the backend | `/opt/rite-exam-portal/backend/deploy/update.sh` |
| Update the website | `/opt/rite-exam-portal/frontend/deploy/update.sh` |
| Add an admin / reset a password | see below |

```bash
sudo systemd-run --pty --uid=rite-exam -p EnvironmentFile=/opt/rite-exam-portal/backend/.env \
  -p WorkingDirectory=/opt/rite-exam-portal/backend \
  /opt/rite-exam-portal/backend/.venv/bin/python -m app.cli create-admin name@rite.digital 'NewPass123' Full Name
```

**Do not update or restart during a live campus drive.**

If the `nginx` container is ever recreated, its copied files are gone: repeat Steps 7–8. (Mounting host folders
for `/etc/nginx/conf.d` and `/usr/share/nginx/html` avoids this.)

---

## If something goes wrong

Backend log: `sudo journalctl -u rite-exam-portal -n 100 --no-pager`

| Problem | What to do |
|---|---|
| Log: "Cannot connect to the database at 129.213.36.70:5432" / `TimeoutError` | `DATABASE_URL` must use `127.0.0.1`. Restart after fixing |
| Log: `password authentication failed` | User or password in `DATABASE_URL` |
| Log: `permission denied for schema public` | `docker exec postgres-service psql -U postgres -c "ALTER DATABASE rite_exam OWNER TO rite_exam;"` |
| Log: `JWT_SECRET must be set in production` | Fill in `JWT_SECRET` in `backend/.env`, restart |
| Log: `Cannot assign requested address` | Docker is not running (172.17.0.1 missing); the service retries every 5 s |
| Log: "ready on port 3000" | `backend/.env` is missing `PORT=8085` (old name `APP_PORT`) |
| `status=203/EXEC` | `sudo restorecon -R /opt/rite-exam-portal`; check `backend/.venv` exists (Step 4) |
| `npm run build`: `SyntaxError … import module from 'node:module'` | Node.js too old: Step 1, `node --version` must be v22 |
| "502 Bad Gateway" | Backend down (Step 6 checks), or the container cannot reach it (Step 6, firewall line) |
| Blank page / 404 for `/assets/…` | Website not installed in the container: Step 8 |
| `ERR_CONNECTION_TIMED_OUT` in the browser | OCI rules for TCP 80/443 missing (checklist item 3) |
| `nginx -t`: `cannot load certificate` | Certificate path in `rite-exam-portal.conf` does not exist inside the container (Step 7) |
| "413 Request Entity Too Large" (Excel upload) | `client_max_body_size 12m;` missing from the site file; repeat Step 7 |
| Students' camera does not work | Use `https://`; the headers file (Step 7) must be in place |

When asking for help, send the backend log above and `docker exec nginx nginx -t` (remove passwords).

---

## Moving from an earlier setup on this server

```bash
sudo systemctl stop rite-exam-portal 2>/dev/null
cd /opt/rite-exam-portal && git pull                       # or a fresh clone (Step 2)
```
Settings moved: the backend now reads **`/opt/rite-exam-portal/backend/.env`** (earlier: `deploy/.env`).
Copy your old file there (`cp deploy/.env backend/.env` if it still exists), rename `APP_PORT=` to `PORT=`,
and add the `HOST`, `FORWARDED_ALLOW_IPS` and `PG_CONTAINER` lines from Step 5. Then do Steps 4–10.
An old copy outside `/opt` (e.g. a ZIP in `/home/opc/...`) is no longer used and can be deleted.

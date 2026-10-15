# Rite Exam Portal – Deployment Guide

These steps put the Rite Exam Portal live on an Oracle Cloud (OCI) server running **Oracle Linux 8 or 9** that
**already runs nginx and PostgreSQL**. It takes about 30 minutes, and every command can be copied and pasted. No Docker is used.

Run every command as **`opc`** unless it says otherwise. If a check (✅) fails, stop and fix it before going on:
`deploy/preflight.sh` (Step 6) checks almost everything at once and tells you what is wrong.

## How it works

```
Browser ──HTTPS──▶ nginx (already on the server, ports 80/443)
                     │  forwards the portal's domain to
                     ▼
                   Portal service "rite-exam-portal" (systemd) on 127.0.0.1:8085   ← website + API
                     │
                     ▼
                   PostgreSQL on the same server (127.0.0.1:5432), database "rite_exam"
```

- The portal is one Python program, started and restarted automatically by **systemd** (like nginx itself).
- nginx keeps ports 80/443 and the HTTPS certificate. Other websites on that nginx are not affected.
- Port 8085 and the database are only reachable from the server itself, not from the internet.

## What you receive

| Item | Where |
|---|---|
| Source code | https://github.com/Naveenkotagiri/Rite-Exam-Portal |
| Settings file `.env` (contains passwords) | Shared with you separately. Never put it in Git |
| This guide | `DEPLOY.md` in the repository |

---

## Before you start – checklist

| # | Must be ready | How to check |
|---|---|---|
| 1 | OCI server, Oracle Linux 8.10+ or 9, 2+ OCPU, 8 GB RAM, nginx running | `cat /etc/oracle-release` and `sudo nginx -v` |
| 2 | A domain (e.g. `campus-hire.rite.digital`) with a DNS **A record** pointing to the server's public IP | `nslookup campus-hire.rite.digital` shows the server IP |
| 3 | PostgreSQL running on this server | `sudo ss -ltnp \| grep 5432` shows `postgres` |
| 4 | Port **8085** free | `sudo ss -ltnp \| grep 8085` shows nothing |
| 5 | The database and its user exist, **the user owns the database** | See below |
| 6 | PostgreSQL accepts password logins from `127.0.0.1` | See below |

**Item 5** – the DBA runs once (`sudo -u postgres psql`). Use letters and digits only in the password:
```sql
CREATE USER rite_exam WITH PASSWORD 'ChooseAStrongPassword123';
CREATE DATABASE rite_exam OWNER rite_exam;
```
The owner part matters: on PostgreSQL 15 and newer the portal cannot create its tables otherwise
("permission denied for schema public"). The portal creates its tables by itself on first start.

**Item 6** – in `pg_hba.conf` (find it with `sudo -u postgres psql -tAc "SHOW hba_file"`), the line
`host all all 127.0.0.1/32 ...` must end with `scram-sha-256` (or `md5`), **not** `ident`. The first matching line wins.
After a change: `sudo systemctl reload postgresql` (or `postgresql-16`, depending on how PostgreSQL was installed).

> If port 8085 is already used, pick another free port (e.g. 8095) and use it in **both** places:
> `PORT` in `.env` and `proxy_pass` in the nginx file (Step 7).

---

## Installation (one time)

### Step 1 – Log in to the server

```bash
ssh -i <your-key-file> opc@<server-ip>
```

### Step 2 – Install Python 3.12, Node.js 22 and Git

Python runs the portal. Node.js is only used to build the website.

```bash
sudo dnf install -y git python3.12 python3.12-pip nmap-ncat
sudo dnf module reset -y nodejs          # the server may have an old Node.js (e.g. 10) enabled
sudo dnf module install -y nodejs:22
hash -r
```
If `nodejs:22` is not found (older Oracle Linux), install it from NodeSource instead:
```bash
sudo dnf module disable -y nodejs
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs
hash -r
```
✅ `python3.12 --version` shows 3.12.x, and `node --version` shows **v22.x**.
If node still shows an old version, `which -a node` lists every copy; remove or rename the old one (often in `/usr/local/bin`).

### Step 3 – Download the code

The code **must** be a `git clone` in `/opt/rite-exam-portal`. Do not use a ZIP download or another folder:
updates (`update.sh`), the service and SELinux all depend on it.
```bash
sudo mkdir -p /opt/rite-exam-portal && sudo chown opc: /opt/rite-exam-portal
git clone https://github.com/Naveenkotagiri/Rite-Exam-Portal.git /opt/rite-exam-portal
```
If GitHub asks for a password, use a **personal access token**, not the account password.
If the clone says the folder is not empty, an earlier copy is there: move it away first (`sudo mv /opt/rite-exam-portal /opt/rite-exam-portal.old`).

### Step 4 – Put the settings file in place

Copy the `.env` you received to **`/opt/rite-exam-portal/deploy/.env`** (only there; no other `.env` anywhere in the folder).
From your own computer:
```bash
scp -i <your-key-file> .env opc@<server-ip>:/opt/rite-exam-portal/deploy/.env
```
Then on the server:
```bash
cd /opt/rite-exam-portal
sed -i 's/\r$//' deploy/.env       # removes Windows line endings, if any
chmod 600 deploy/.env
```

What is in the file (template with all rules: `deploy/.env.prod.example`):

| Setting | Meaning |
|---|---|
| `PORT` | Port the portal listens on, on 127.0.0.1 only (default `8085`) |
| `DATABASE_URL` | `postgres://rite_exam:PASSWORD@127.0.0.1:5432/rite_exam`. Always `127.0.0.1`, **never** the server's public IP |
| `DATABASE_SSL` | `true` only if the database requires SSL, otherwise `false` |
| `JWT_SECRET` | Secret for admin logins (`openssl rand -hex 32`). Do not change after go-live |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin account, created on first start |
| `WEB_CONCURRENCY` | Worker processes, about one per vCPU (default 4) |

Format: `KEY=value`, one per line, no quotes, no `# comment` after a value.

### Step 5 – Build the portal

```bash
cd /opt/rite-exam-portal
unset NODE_ENV
npm ci --ignore-scripts --no-audit --no-fund     # website build tools
npm run build                                    # builds the website into dist/
python3.12 -m venv backend/.venv                 # private Python environment for the portal
backend/.venv/bin/pip install -q -r backend/requirements.txt
```
✅ `npm run build` ends with `✓ built in …`, and the last command finishes without a red `ERROR`.

### Step 6 – Start the portal as a service

```bash
# A system user that runs the portal (it cannot log in)
sudo useradd --system --no-create-home --shell /sbin/nologin rite-exam

sudo restorecon -R /opt/rite-exam-portal         # correct SELinux labels (needed if files were ever moved from /home)
sudo install -m 644 /opt/rite-exam-portal/deploy/rite-exam-portal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rite-exam-portal
```
Wait ~10 seconds, then check it:
```bash
curl http://127.0.0.1:8085/api/health                # must print {"ok":true}
/opt/rite-exam-portal/deploy/preflight.sh            # lists anything that is still wrong
```
✅ The curl prints `{"ok":true}`. This is the real test: `systemctl status` can say "active (running)" even while
the portal cannot reach the database. If it fails: `sudo journalctl -u rite-exam-portal -n 50 --no-pager`
and see "If something goes wrong".

The service starts by itself after a reboot and restarts by itself if it ever crashes.

### Step 7 – Connect nginx to the portal

**7.1 Copy the site file** (`deploy/nginx/rite-exam-portal.conf`):
```bash
sudo cp /opt/rite-exam-portal/deploy/nginx/rite-exam-portal.conf /etc/nginx/conf.d/
```

**7.2 Put in the domain:** `sudo nano /etc/nginx/conf.d/rite-exam-portal.conf` and replace every **`exam.example.com`**
(3 places) with the portal's domain. Keep `listen 443 ssl http2;` exactly like that: the form `http2 on;` breaks older nginx.

**7.3 HTTPS certificate – choose one:**

**a) Certificate files from Rite IT** (e.g. `generic.rite.digital.crt` and `.key`):
```bash
sudo cp <file>.crt /etc/pki/tls/certs/
sudo cp <file>.key /etc/pki/tls/private/ && sudo chmod 600 /etc/pki/tls/private/<file>.key
sudo restorecon -v /etc/pki/tls/certs/<file>.crt /etc/pki/tls/private/<file>.key
```
In the nginx file set:
```nginx
    ssl_certificate     /etc/pki/tls/certs/<file>.crt;
    ssl_certificate_key /etc/pki/tls/private/<file>.key;
```

**b) Free Let's Encrypt certificate:**
```bash
# certbot comes from EPEL (Oracle Linux 9; on Oracle Linux 8 use el8 / ol8_developer_EPEL)
sudo dnf install -y oracle-epel-release-el9 && sudo dnf config-manager --enable ol9_developer_EPEL
sudo dnf install -y certbot python3-certbot-nginx
```
Put `#` in front of every line of the second `server { ... }` block (the `listen 443` one), then:
```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --nginx -d <domain>        # gets the certificate only; changes no files
```
Remove the `#` again (the certificate paths in the file now exist). Renewal runs automatically.

**7.4 Allow nginx to forward to the portal** (SELinux; otherwise "502 Bad Gateway"):
```bash
sudo setsebool -P httpd_can_network_connect 1
```

**7.5 Test and reload nginx** (other websites keep running):
```bash
sudo nginx -t && sudo systemctl reload nginx
```
✅ `syntax is ok` and `test is successful`. A warning that `http2` is deprecated is harmless.

Do not add security headers (HSTS, CSP …) in nginx: the portal already sends them.

### Step 8 – Open ports 80 and 443 to the internet

Otherwise the browser shows `ERR_CONNECTION_TIMED_OUT`. Two firewalls must allow them:

- **OCI Console:** Networking → Virtual Cloud Networks → the server's VCN → Security Lists (or the Network Security Group on the
  server's VNIC) → **Add Ingress Rules**, one per port: Source CIDR `0.0.0.0/0`, IP Protocol `TCP`, Destination Port `80`;
  and the same for `443`.
- **On the server:**
  ```bash
  sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
  ```

Open **only** 80 and 443. Do **not** open 8085 (the portal) or 5432 (the database) to the internet.

✅ From **your own computer** (PowerShell): `Test-NetConnection <domain> -Port 443` shows `TcpTestSucceeded : True`.

### Step 9 – Check it works

```bash
/opt/rite-exam-portal/deploy/preflight.sh            # must end with "All checks passed"
```

| Open in a browser | Expected |
|---|---|
| `https://<domain>/api/health` | `{"ok":true}` and a padlock in the address bar |
| `https://<domain>/admin` | Admin login page. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` |

**Optional, recommended before the first real drive – a 100-student rehearsal** (about 3 minutes). It creates its own
test drive, runs 100 simulated students at once (including tab switchers, time-ups, device switches), checks every
score and rule, prints response times, and deletes the test drive again. Never run it during a real drive.
```bash
cd /opt/rite-exam-portal
backend/.venv/bin/pip install -q httpx
ADMIN_EMAIL='<admin email>' ADMIN_PASSWORD='<admin password>' backend/.venv/bin/python test/load/exam_simulation.py
```
✅ Ends with `Checks: … passed, 0 failed`.

When both browser checks work, the portal is live. Tell the project team.

### Step 10 – Turn on daily backups

Needs `pg_dump` of the same or a newer major version than the server (it comes with PostgreSQL).
```bash
mkdir -p /opt/rite-exam-portal/deploy/backups
/opt/rite-exam-portal/deploy/backup.sh               # one test run: prints "backup written: ..."
(crontab -l 2>/dev/null; echo "30 2 * * * /opt/rite-exam-portal/deploy/backup.sh >> /opt/rite-exam-portal/deploy/backups/backup.log 2>&1") | crontab -
```
A backup is saved every night at 2:30 in `/opt/rite-exam-portal/deploy/backups/` and kept for 14 days.

---

## Everyday tasks

| Task | Command |
|---|---|
| Is everything OK? | `/opt/rite-exam-portal/deploy/preflight.sh` |
| Is it running? | `curl http://127.0.0.1:8085/api/health` |
| See the log | `sudo journalctl -u rite-exam-portal -f` (Ctrl+C to stop) |
| Restart | `sudo systemctl restart rite-exam-portal` |
| Install a new version | `/opt/rite-exam-portal/deploy/update.sh` (pulls, rebuilds, restarts, checks health) |
| Stop | `sudo systemctl stop rite-exam-portal` (data stays in the database) |
| Changed `.env` | `sudo systemctl restart rite-exam-portal` |
| Add an admin / reset a password | see below |

Add an admin or reset a password (replace the last three values):
```bash
sudo systemd-run --pty --uid=rite-exam -p EnvironmentFile=/opt/rite-exam-portal/deploy/.env \
  -p WorkingDirectory=/opt/rite-exam-portal/backend \
  /opt/rite-exam-portal/backend/.venv/bin/python -m app.cli create-admin name@rite.digital 'NewPass123' Full Name
```

**Do not restart or update while a campus drive is running.** Students would be interrupted.

---

## If something goes wrong

First: `/opt/rite-exam-portal/deploy/preflight.sh`, then the log: `sudo journalctl -u rite-exam-portal -n 100 --no-pager`

| Problem | What to do |
|---|---|
| Log: "Cannot connect to the database at 129.213.36.70:5432" / `TimeoutError` | `DATABASE_URL` must use `127.0.0.1`, not the public IP. Restart after fixing |
| Log: `Ident authentication failed` / `password authentication failed` | Checklist item 6 (`pg_hba.conf`), or the user/password in `DATABASE_URL` |
| Log: `permission denied for schema public` | The database user must own the database: `sudo -u postgres psql -c "ALTER DATABASE rite_exam OWNER TO rite_exam;"` |
| Log: `JWT_SECRET must be set in production` | Fill in `JWT_SECRET` in `deploy/.env`, then restart |
| Log: "ready on port 3000" instead of 8085 | `deploy/.env` has `APP_PORT`; rename it to `PORT` |
| Log: "address already in use" | Port 8085 is taken. Change `PORT` in `.env` and `proxy_pass` in the nginx file to a free port |
| `status=203/EXEC` in `systemctl status` | `sudo restorecon -R /opt/rite-exam-portal`; if it persists, Step 5 was not completed (`backend/.venv` missing) |
| `npm run build`: `SyntaxError: Unexpected identifier` (`import module from 'node:module'`) | Node.js is too old. Step 2; `node --version` must show v22 |
| `ERR_CONNECTION_TIMED_OUT` in the browser | Ports 80/443 are blocked. Step 8 (OCI ingress rules **and** server firewall) |
| "502 Bad Gateway" | The portal is down (Step 6 curl) or SELinux: Step 7.4 |
| `nginx -t`: `unknown directive "http2"` | Use `listen 443 ssl http2;`, not `http2 on;` |
| `nginx -t`: `cannot load certificate` / `Permission denied` | Wrong path, or the files kept a wrong SELinux label: run the `restorecon` line of Step 7.3a |
| The site does not open | `nslookup <domain>` must show this server's IP; check the domain in the nginx file; `sudo nginx -t` |
| "413 Request Entity Too Large" when uploading Excel | `client_max_body_size 12m;` must be in the portal's HTTPS server block; reload nginx |
| Students' camera does not work | Use `https://`. Cameras never work on plain `http` |
| Admin login fails | Reset the password (Everyday tasks) |

If you are stuck, send the project team the output of `preflight.sh` and `sudo journalctl -u rite-exam-portal -n 100 --no-pager`
(remove any passwords first).

---

## Moving from an earlier setup

**From the earlier Docker setup** (run BEFORE `git pull`, which removes the compose file):
```bash
cd /opt/rite-exam-portal/deploy
docker compose -f docker-compose.prod.yml --profile local-db --profile caddy down
```
If the old setup used the `local-db` container, the data is in a Docker volume: copy it into the new database first
(`pg_dump` from `127.0.0.1:5433`, restore into `rite_exam`), or ask the project team.

**From a copy outside `/opt`** (e.g. a ZIP in `/home/opc/...`): stop and remove the old service, then follow this guide
from Step 3 with a fresh clone. Copy only your `.env` across (to `deploy/.env`), and rename `APP_PORT=` to `PORT=` in it.
```bash
sudo systemctl disable --now rite-exam-portal
```

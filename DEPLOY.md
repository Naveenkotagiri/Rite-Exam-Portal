# Rite Exam Portal – Deployment Guide

These steps put the Rite Exam Portal live on a Linux server on Oracle Cloud (OCI) that **already runs nginx and PostgreSQL**.
It takes about 30 minutes, and every command can be copied and pasted. No Docker is used.

## How it works

```
Browser ──HTTPS──▶ nginx (already on the server, ports 80/443)
                     │  forwards the portal's domain to
                     ▼
                   Portal service "rite-exam-portal" (systemd) on 127.0.0.1:8085   ← website + API, one service
                     │
                     ▼
                   PostgreSQL on the same server (127.0.0.1:5432), database "rite_exam"
```

- The portal is one Python program, started and restarted automatically by **systemd** (like nginx itself).
- nginx keeps ports 80/443 and the HTTPS certificate. Other websites on that nginx are not affected.
- Port 8085 is only reachable from the server itself, not from the internet.

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
| 1 | Linux server on OCI (Oracle Linux 9, or Ubuntu 24.04), 2+ OCPU, 8 GB RAM, with nginx running | `sudo nginx -v` |
| 2 | A domain for the portal (e.g. `campus-hire.rite.digital`) with a DNS **A record** pointing to the server's public IP | `nslookup campus-hire.rite.digital` shows the server IP |
| 3 | Ports 80 and 443 open in OCI (Security List / NSG) and in the server firewall | Step 8 |
| 4 | Port **8085** free on the server | `sudo ss -ltnp \| grep 8085` shows nothing |
| 5 | PostgreSQL is running on this server | `nc -zv 127.0.0.1 5432` says succeeded/connected |
| 6 | The database `rite_exam` and its user exist | DBA runs once: `CREATE DATABASE rite_exam;` |
| 7 | PostgreSQL accepts password logins from `127.0.0.1` | In `pg_hba.conf` the `host all all 127.0.0.1/32` line ends with `scram-sha-256` (or `md5`), **not** `ident`. Reload PostgreSQL after a change |

The portal creates its tables by itself on first start.

> If port 8085 is already used, pick another free port (e.g. 8095) and use it in **both** places:
> `PORT` in `.env` and `proxy_pass` in the nginx file (Step 7).

---

## Installation (one time)

### Step 1 – Log in to the server

```bash
ssh -i <your-key-file> <user>@<server-ip>
```
The user is usually `opc` on Oracle Linux and `ubuntu` on Ubuntu.

### Step 2 – Install Python 3.12, Node.js 22 and Git

Python runs the portal. Node.js is only used to build the website (Step 5).

**Oracle Linux 9:**
```bash
sudo dnf install -y git python3.12 python3.12-pip
sudo dnf module install -y nodejs:22
```
If `nodejs:22` is not found: `curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs`

**Ubuntu 24.04:**
```bash
sudo apt update && sudo apt install -y git python3.12-venv
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
```

Check: `python3.12 --version` shows 3.12.x and `node --version` shows v22.x.

### Step 3 – Download the code

```bash
sudo mkdir -p /opt/rite-exam-portal && sudo chown $USER /opt/rite-exam-portal
git clone https://github.com/Naveenkotagiri/Rite-Exam-Portal.git /opt/rite-exam-portal
```
If GitHub asks for a password, use a **personal access token**, not the account password.

### Step 4 – Put the settings file in place

Copy the `.env` you received to **`/opt/rite-exam-portal/deploy/.env`**. From your own computer:
```bash
scp -i <your-key-file> .env <user>@<server-ip>:/opt/rite-exam-portal/deploy/.env
```
Then on the server:
```bash
chmod 600 /opt/rite-exam-portal/deploy/.env
```

What is in the file (template: `deploy/.env.prod.example`):

| Setting | Meaning |
|---|---|
| `PORT` | Port the portal listens on, on 127.0.0.1 only (default `8085`) |
| `DATABASE_URL` | `postgres://USER:PASSWORD@127.0.0.1:5432/rite_exam`. Use `127.0.0.1`, **not** the server's public IP |
| `DATABASE_SSL` | `true` only if the database requires SSL, otherwise `false` |
| `JWT_SECRET` | Secret for admin logins (`openssl rand -hex 32`). Do not change after go-live |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin account, created on first start |
| `WEB_CONCURRENCY` | Worker processes, about one per vCPU (default 4) |

### Step 5 – Build the portal

```bash
cd /opt/rite-exam-portal
npm ci --ignore-scripts --no-audit --no-fund     # website build tools
npm run build                                    # builds the website into dist/
python3.12 -m venv backend/.venv                 # private Python environment for the portal
backend/.venv/bin/pip install -q -r backend/requirements.txt
```
Takes 2–3 minutes. The last command must finish without a red `ERROR`.

### Step 6 – Start the portal as a service

```bash
# A system user that runs the portal (it cannot log in)
sudo useradd --system --no-create-home --shell /sbin/nologin rite-exam

sudo cp /opt/rite-exam-portal/deploy/rite-exam-portal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rite-exam-portal
```
Wait ~10 seconds, then check it:
```bash
sudo systemctl status rite-exam-portal --no-pager    # Active: active (running)
curl http://127.0.0.1:8085/api/health                # prints {"ok":true}
```
Do not continue until the curl prints `{"ok":true}`. If it doesn't, run `sudo journalctl -u rite-exam-portal -n 100 --no-pager`
and see "If something goes wrong".

The service starts by itself after a reboot and restarts by itself if it ever crashes.

### Step 7 – Connect nginx to the portal

The ready-made nginx file is `deploy/nginx/rite-exam-portal.conf`.

**7.1 Copy it into nginx**
```bash
# Oracle Linux / RHEL
sudo cp /opt/rite-exam-portal/deploy/nginx/rite-exam-portal.conf /etc/nginx/conf.d/

# Ubuntu
sudo cp /opt/rite-exam-portal/deploy/nginx/rite-exam-portal.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/rite-exam-portal.conf /etc/nginx/sites-enabled/
```

**7.2 Put in the domain:** open the copied file (`sudo nano <path>`) and replace every **`exam.example.com`** (3 places) with the portal's domain.

**7.3 HTTPS certificate – choose one:**
- **Certificate from Rite IT:** set `ssl_certificate` and `ssl_certificate_key` in the file to the paths of the certificate files
  (e.g. `/etc/pki/tls/certs/generic.rite.digital.crt` and `.key`).
- **Free Let's Encrypt certificate:** in the file, put `#` in front of every line of the second `server { ... }` block (the `listen 443` one),
  then run `sudo nginx -t && sudo systemctl reload nginx` and `sudo certbot --nginx -d <domain>`.
  Certbot gets the certificate and adds HTTPS for you. (Install certbot first if needed:
  Oracle Linux `sudo dnf install -y certbot python3-certbot-nginx`, Ubuntu `sudo apt install -y certbot python3-certbot-nginx`.)
  Then add `client_max_body_size 12m;` inside the HTTPS server block that certbot created, if it is not there.

**7.4 Oracle Linux only** – allow nginx to forward to the portal (otherwise you get "502 Bad Gateway"):
```bash
sudo setsebool -P httpd_can_network_connect 1
```

**7.5 Test and reload nginx** (other websites keep running):
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Step 8 – Open ports 80 and 443 to the internet

Otherwise the browser shows `ERR_CONNECTION_TIMED_OUT`. Two firewalls must allow them: OCI's, and the server's own.

- **OCI Console:** Networking → Virtual Cloud Networks → the server's VCN → Security Lists (or the Network Security Group on the
  server's VNIC) → **Add Ingress Rules**, one per port:
  Source CIDR `0.0.0.0/0`, IP Protocol `TCP`, Destination Port `80`; and the same for `443`.
- **On the server:**
  ```bash
  # Oracle Linux / RHEL (firewalld)
  sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload

  # Ubuntu on OCI (iptables)
  sudo iptables -I INPUT 5 -p tcp -m multiport --dports 80,443 -m state --state NEW -j ACCEPT
  sudo netfilter-persistent save
  ```

Open **only** 80 and 443. Do **not** open 8085 (the portal) or 5432 (the database) to the internet.

Check from **your own computer** (not the server), e.g. in PowerShell: `Test-NetConnection <domain> -Port 443` must show `TcpTestSucceeded : True`.

### Step 9 – Check it works

| Open in a browser | Expected |
|---|---|
| `https://<domain>/api/health` | `{"ok":true}` and a padlock in the address bar |
| `https://<domain>/admin` | Admin login page. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` |

When both work, the portal is live. Tell the project team.

### Step 10 – Turn on daily backups

Needs `pg_dump`, which comes with PostgreSQL (`pg_dump --version`).
```bash
chmod +x /opt/rite-exam-portal/deploy/backup.sh /opt/rite-exam-portal/deploy/update.sh
mkdir -p /opt/rite-exam-portal/deploy/backups
(crontab -l 2>/dev/null; echo "30 2 * * * /opt/rite-exam-portal/deploy/backup.sh >> /opt/rite-exam-portal/deploy/backups/backup.log 2>&1") | crontab -
```
A backup is saved every night at 2:30 in `/opt/rite-exam-portal/deploy/backups/` and kept for 14 days.

---

## Everyday tasks

| Task | Command |
|---|---|
| Is it running? | `sudo systemctl status rite-exam-portal --no-pager` |
| See the log | `sudo journalctl -u rite-exam-portal -f` (Ctrl+C to stop) |
| Restart | `sudo systemctl restart rite-exam-portal` |
| Install a new version | `/opt/rite-exam-portal/deploy/update.sh` (pulls, rebuilds, restarts, checks health) |
| Stop | `sudo systemctl stop rite-exam-portal` (data stays in the database) |
| Changed `.env` | `sudo systemctl restart rite-exam-portal` |
| Add an admin / reset a password | `cd /opt/rite-exam-portal/backend && (set -a; . ../deploy/.env; .venv/bin/python -m app.cli create-admin name@rite.digital NewPass123 Full Name)` |

**Do not restart or update while a campus drive is running.** Students would be interrupted.

---

## If something goes wrong

First look at the log: `sudo journalctl -u rite-exam-portal -n 100 --no-pager`

| Problem | What to do |
|---|---|
| curl in Step 6 fails / service keeps restarting | Read the log. Usually a wrong `DATABASE_URL`, the `rite_exam` database is missing, or PostgreSQL is not running |
| Log: `TimeoutError` or "Cannot connect to the database" | `DATABASE_URL` must use `127.0.0.1`, not the public IP. Check `nc -zv 127.0.0.1 5432` |
| Log: `Ident authentication failed` / `password authentication failed` | Fix the `127.0.0.1/32` line in `pg_hba.conf` (checklist item 7), or the user/password in `DATABASE_URL` |
| Log: `JWT_SECRET must be set in production` | Fill in `JWT_SECRET` in `deploy/.env`, then restart |
| Log: "address already in use" | Port 8085 is taken. Change `PORT` in `.env` and `proxy_pass` in the nginx file to a free port |
| `status=203/EXEC` in `systemctl status` | Step 5 was not completed: `backend/.venv` is missing. Run Step 5 again |
| `ERR_CONNECTION_TIMED_OUT` in the browser | Ports 80/443 are blocked. Do Step 8 (OCI ingress rules **and** server firewall) |
| "502 Bad Gateway" | The portal is down (check Step 6 curl) or, on Oracle Linux, run Step 7.4 |
| `nginx -t`: `unknown directive "http2"` | Use `listen 443 ssl http2;` (as in the repository file), not `http2 on;` |
| `nginx -t`: `cannot load certificate ... /etc/letsencrypt/...` | The certificate does not exist yet. Follow Step 7.3 (comment out the `listen 443` block, then run certbot) |
| The site does not open | `nslookup <domain>` must show this server's IP; check the nginx file has the right domain; `sudo nginx -t` |
| Certificate warning in the browser | Wrong certificate paths in the nginx file, or rerun `sudo certbot --nginx -d <domain>` |
| "413 Request Entity Too Large" when uploading Excel | Add `client_max_body_size 12m;` to the portal's HTTPS server block, reload nginx |
| Students' camera does not work | Use `https://`. Cameras never work on plain `http` |
| Admin login fails | Reset the password with the command in "Everyday tasks" |

If you are stuck, send the project team the output of `sudo journalctl -u rite-exam-portal -n 100 --no-pager`
(remove any passwords first).

---

## Moving from the earlier Docker setup

If the portal was started with Docker on this server before:
```bash
cd /opt/rite-exam-portal/deploy
docker compose -f docker-compose.prod.yml down      # run BEFORE git pull (the file is removed by the pull)
git -C /opt/rite-exam-portal pull
```
In `deploy/.env`, rename `APP_PORT=` to `PORT=` and make sure `DATABASE_URL` uses `127.0.0.1`. Then do Steps 2, 5, 6 and 10.

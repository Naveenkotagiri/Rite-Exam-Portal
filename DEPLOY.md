# Rite Exam Portal – Deployment Guide

These steps put the Rite Exam Portal live on a Linux server on Oracle Cloud (OCI) that **already runs nginx**.
It takes about 30 minutes, and every command can be copied and pasted.

## How it works

```
Browser ──HTTPS──▶ nginx (already on the server, port 443)
                     │  forwards the portal's domain to
                     ▼
                   Portal container (Docker) on 127.0.0.1:8085   ← website + API, one container
                     │
                     ▼
                   PostgreSQL server 129.213.36.70:5432, database "rite_exam"
```

- Only **one Docker container** runs: `app`.
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
| 1 | Linux server on OCI (Oracle Linux 9 or Ubuntu 22.04/24.04, 2+ OCPU, 8 GB RAM) with nginx running | `sudo nginx -v` |
| 2 | A domain for the portal (e.g. `exam.rite.digital`) with a DNS **A record** pointing to the server's public IP | `nslookup exam.rite.digital` shows the server IP |
| 3 | Ports 80 and 443 open in OCI (Security List / NSG) | Other nginx sites already work |
| 4 | Port **8085** free on the server | `sudo ss -ltnp \| grep 8085` shows nothing |
| 5 | Server can reach the database | `nc -zv 129.213.36.70 5432` says succeeded/connected |
| 6 | The database `rite_exam` exists | DBA runs once on 129.213.36.70: `CREATE DATABASE rite_exam;` |

The portal creates its tables by itself on first start.

> If port 8085 is already used, pick another free port (e.g. 8095) and use it in **both** places:
> `APP_PORT` in `.env` and `proxy_pass` in the nginx file (Step 6).

---

## Installation (one time)

### Step 1 – Log in to the server

```bash
ssh -i <your-key-file> <user>@<server-ip>
```
The user is usually `opc` on Oracle Linux and `ubuntu` on Ubuntu.

### Step 2 – Install Docker and Git (skip if `docker compose version` already works)

**Oracle Linux:**
```bash
sudo dnf install -y dnf-utils git
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
```

**Ubuntu:**
```bash
sudo apt update && sudo apt install -y git
curl -fsSL https://get.docker.com | sudo sh
```

**Both** – let your user run Docker, then log out and log in again:
```bash
sudo usermod -aG docker $USER
exit
```
After logging in again, `docker ps` must work without an error.

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

What is in the file (for reference):

| Setting | Meaning |
|---|---|
| `APP_PORT` | Port the portal listens on, on 127.0.0.1 only (default `8085`) |
| `DATABASE_URL` | `postgres://USER:PASSWORD@129.213.36.70:5432/rite_exam` |
| `DATABASE_SSL` | `true` only if the database requires SSL, otherwise `false` |
| `JWT_SECRET` | Secret for admin logins. Do not change after go-live |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin account, created on first start |
| `WEB_CONCURRENCY` | Worker processes, about one per vCPU (default 4) |

### Step 5 – Start the portal

```bash
cd /opt/rite-exam-portal/deploy
docker compose -f docker-compose.prod.yml up -d --build
```
The first start takes 3–5 minutes. Then check it:
```bash
docker compose -f docker-compose.prod.yml ps        # app → running (healthy after ~1 minute)
curl http://127.0.0.1:8085/api/health               # prints {"ok":true}
```
Do not continue until the curl prints `{"ok":true}`. If it doesn't, see "If something goes wrong".

### Step 6 – Connect nginx to the portal

The ready-made nginx file is `deploy/nginx/rite-exam-portal.conf`.

**6.1 Copy it into nginx**
```bash
# Oracle Linux / RHEL
sudo cp /opt/rite-exam-portal/deploy/nginx/rite-exam-portal.conf /etc/nginx/conf.d/

# Ubuntu
sudo cp /opt/rite-exam-portal/deploy/nginx/rite-exam-portal.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/rite-exam-portal.conf /etc/nginx/sites-enabled/
```

**6.2 Put in the domain:** open the copied file (`sudo nano <path>`) and replace every **`exam.example.com`** (3 places) with the portal's domain.

**6.3 HTTPS certificate – choose one:**
- **Certificate from Rite IT:** copy the files to the server and set `ssl_certificate` and `ssl_certificate_key` in the file to their paths.
- **Free Let's Encrypt certificate:** in the file, put `#` in front of every line of the second `server { ... }` block (the `listen 443` one),
  then run `sudo nginx -t && sudo systemctl reload nginx` and `sudo certbot --nginx -d <domain>`.
  Certbot gets the certificate and adds HTTPS for you. (Install certbot first if needed:
  Oracle Linux `sudo dnf install -y certbot python3-certbot-nginx`, Ubuntu `sudo apt install -y certbot python3-certbot-nginx`.)
  Then add `client_max_body_size 12m;` inside the HTTPS server block that certbot created, if it is not there.

**6.4 Oracle Linux only** – allow nginx to forward to the portal (otherwise you get "502 Bad Gateway"):
```bash
sudo setsebool -P httpd_can_network_connect 1
```

**6.5 Test and reload nginx** (other websites keep running):
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Step 7 – Check it works

| Open in a browser | Expected |
|---|---|
| `https://<domain>/api/health` | `{"ok":true}` and a padlock in the address bar |
| `https://<domain>/admin` | Admin login page. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` |

When both work, the portal is live. Tell the project team.

### Step 8 – Turn on daily backups

```bash
chmod +x /opt/rite-exam-portal/deploy/backup.sh
(crontab -l 2>/dev/null; echo "30 2 * * * /opt/rite-exam-portal/deploy/backup.sh >> /var/log/rite-exam-backup.log 2>&1") | crontab -
```
A backup is saved every night at 2:30 in `/opt/rite-exam-portal/deploy/backups/` and kept for 14 days.

---

## Everyday tasks

Run inside `/opt/rite-exam-portal/deploy`:

| Task | Command |
|---|---|
| Is it running? | `docker compose -f docker-compose.prod.yml ps` |
| See the log | `docker compose -f docker-compose.prod.yml logs -f app` (Ctrl+C to stop) |
| Restart | `docker compose -f docker-compose.prod.yml restart app` |
| Install a new version | `git -C /opt/rite-exam-portal pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Stop | `docker compose -f docker-compose.prod.yml down` (data stays in the database) |
| Add an admin / reset a password | `docker compose -f docker-compose.prod.yml exec app python -m app.cli create-admin name@rite.digital 'NewPass@123' Full Name` |

**Do not restart or update while a campus drive is running.** Students would be interrupted.

---

## If something goes wrong

| Problem | What to do |
|---|---|
| curl in Step 5 fails / `app` keeps restarting | `docker compose -f docker-compose.prod.yml logs app`. Usually a wrong `DATABASE_URL`, the `rite_exam` database is missing, or port 5432 is not reachable |
| "port is already allocated" when starting | Port 8085 is taken. Change `APP_PORT` in `.env` and `proxy_pass` in the nginx file to a free port |
| "502 Bad Gateway" | The portal is down (check Step 5 curl) or, on Oracle Linux, run Step 6.4 |
| The site does not open | `nslookup <domain>` must show this server's IP; check the nginx file has the right domain; `sudo nginx -t` |
| Certificate warning in the browser | Wrong certificate paths in the nginx file, or rerun `sudo certbot --nginx -d <domain>` |
| "413 Request Entity Too Large" when uploading Excel | Add `client_max_body_size 12m;` to the portal's HTTPS server block, reload nginx |
| Students' camera does not work | Use `https://`. Cameras never work on plain `http` |
| Admin login fails | Reset the password with the `create-admin` command above |

If you are stuck, send the project team the output of `docker compose -f docker-compose.prod.yml logs --tail 100 app`.

---

## Optional: server without nginx

If nothing uses ports 80/443 on the server, skip Step 6. Add `DOMAIN=<domain>` to `.env` and start with:
```bash
docker compose -f docker-compose.prod.yml --profile caddy up -d --build
```
A Caddy container then handles HTTPS and the certificate automatically.

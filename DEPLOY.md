# Rite Exam Portal – Deployment Guide

This guide puts the Rite Exam Portal live on one Linux server on Oracle Cloud (OCI).
It takes about 30 minutes. Every command can be copied and pasted.

## How it runs

```
Students & admins (browser)
        │  HTTPS (443)  https://<DOMAIN>
        ▼
┌──────────────────────────── Portal server ─────────────────────────────┐
│  nginx (already on the server) → HTTPS certificate, forwards the domain │
│        │  http://127.0.0.1:8085 (not reachable from the internet)       │
│        ▼                                                                │
│  app container → the portal: React website + Python API                │
└─────────────────────────────────────────────────────────────────────────┘
        │  PostgreSQL (5432)
        ▼
Rite PostgreSQL server (129.213.36.70) – database "rite_exam"
```

Only one container (`app`) runs on the portal server. The server's existing nginx handles HTTPS
and forwards everything for the portal's domain (website and API) to it. The database is Rite's existing PostgreSQL server.

## What you receive

| Item | Where |
|---|---|
| Source code | https://github.com/Naveenkotagiri/Rite-Exam-Portal |
| Settings file with passwords (`.env`) | Shared with you separately and securely – never put it in Git |
| This guide | `DEPLOY.md` in the repository |

---

## Part A – Check these are ready (before you start)

Tick each one. If one is missing, the portal will not work.

| # | Item | How to check |
|---|---|---|
| 1 | A Linux server on OCI (Oracle Linux 9 or Ubuntu 22.04/24.04, at least 2 OCPU / 8 GB RAM, 50 GB disk) with a public IP | You can log in with SSH |
| 2 | A domain name for the portal, e.g. `exam.rite.digital`, with a DNS **A record** pointing to the server's public IP | `nslookup exam.rite.digital` returns the server's IP |
| 3 | nginx installed on the server, and ports **80** and **443** open to the internet (OCI Security List / NSG: ingress TCP 80 and 443 from `0.0.0.0/0`) | `sudo nginx -v` works; OCI console |
| 3b | Port **8085** is free on the server (the portal uses it on 127.0.0.1 only) | `sudo ss -ltnp \| grep 8085` shows nothing. If it is taken, pick another port: `APP_PORT` in `.env` and `proxy_pass` in the nginx file |
| 4 | The portal server can reach the database at `129.213.36.70`, port **5432** | From the server: `nc -zv 129.213.36.70 5432` says "succeeded"/"connected" |
| 5 | On the database: a user and database for the portal exist (SQL below) | Ask the database administrator |
| 6 | The settings file `.env` received from the project team, with no `TODO` left in it | Open it and check |

SQL for the database administrator (run once on 129.213.36.70):

```sql
CREATE USER rite_exam WITH PASSWORD 'a-strong-password';
CREATE DATABASE rite_exam OWNER rite_exam;
```

The portal creates all its tables by itself on first start.
For safety, allow port 5432 on the database **only from the portal server's IP**, not from the whole internet.

---

## Part B – Install (one time)

### Step 1 – Log in to the server

```bash
ssh -i <your-key-file> <user>@<server-ip>
```
The user is usually `opc` on Oracle Linux and `ubuntu` on Ubuntu.

### Step 2 – Open ports 80 and 443 on the server's firewall

Skip this step if nginx already serves websites on this server (the ports are already open).

**Oracle Linux:**
```bash
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload
```

**Ubuntu:**
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### Step 3 – Install Docker and Git

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

**Both – let your user run Docker, then log out and in again:**
```bash
sudo usermod -aG docker $USER
exit
```
Log in again (Step 1) and check: `docker ps` must run without an error.

### Step 4 – Download the code

```bash
sudo mkdir -p /opt/rite-exam-portal && sudo chown $USER /opt/rite-exam-portal
git clone https://github.com/Naveenkotagiri/Rite-Exam-Portal.git /opt/rite-exam-portal
```
If GitHub asks for a password, use a **personal access token** (GitHub → Settings → Developer settings → Personal access tokens), not the account password.

### Step 5 – Put the settings file in place

Copy the `.env` file you received to the server, as **`/opt/rite-exam-portal/deploy/.env`**.
From your own computer, for example:
```bash
scp -i <your-key-file> .env <user>@<server-ip>:/opt/rite-exam-portal/deploy/.env
```
Then on the server, make it private:
```bash
chmod 600 /opt/rite-exam-portal/deploy/.env
```

What is in the file (for reference):

| Setting | Meaning |
|---|---|
| `APP_PORT` | Port the portal listens on, on 127.0.0.1 only (default `8085`); nginx forwards to it |
| `DATABASE_URL` | `postgres://USER:PASSWORD@129.213.36.70:5432/DATABASE` |
| `DATABASE_SSL` | `true` only if the database requires SSL; otherwise `false` |
| `JWT_SECRET` | Random secret for admin logins – do not change after go-live |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first admin account, created on first start |
| `WEB_CONCURRENCY` | Number of worker processes; about one per vCPU (default 4) |

### Step 6 – Start the portal

```bash
cd /opt/rite-exam-portal/deploy
docker compose -f docker-compose.prod.yml up -d --build
```
The first start takes 3–5 minutes (it builds the portal). Then check it is running:
```bash
docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1:8085/api/health
```
You should see `app` with status `running` / `healthy` (after about a minute), and the curl prints `{"ok":true}`.

### Step 7 – Connect nginx to the portal

The ready-made nginx site is in the repository: `deploy/nginx/rite-exam-portal.conf`.

1. Copy it into nginx:
   ```bash
   # Oracle Linux / RHEL
   sudo cp /opt/rite-exam-portal/deploy/nginx/rite-exam-portal.conf /etc/nginx/conf.d/
   # Ubuntu
   sudo cp /opt/rite-exam-portal/deploy/nginx/rite-exam-portal.conf /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/rite-exam-portal.conf /etc/nginx/sites-enabled/
   ```
2. Open the copied file (`sudo nano <path>`) and replace **`exam.example.com`** (3 places) with the portal's domain.
3. HTTPS certificate – choose one:
   - **Free Let's Encrypt certificate:** comment out the `listen 443` server block first (nginx cannot start
     without the certificate files), then run `sudo certbot --nginx -d <DOMAIN>`; certbot adds the certificate for you.
   - **Certificate from Rite IT:** put the files on the server and set `ssl_certificate` / `ssl_certificate_key` to their paths.
4. **Oracle Linux only** – allow nginx to forward to the portal (SELinux blocks it otherwise, giving "502 Bad Gateway"):
   ```bash
   sudo setsebool -P httpd_can_network_connect 1
   ```
5. Check and reload nginx (existing websites keep running):
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

### Step 8 – Check it works

| Check | Expected |
|---|---|
| Open `https://<DOMAIN>/api/health` | Shows `{"ok":true}` and the browser shows a padlock |
| Open `https://<DOMAIN>/admin` | Login page; log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` |
| After logging in: **Admins → Change my password** | Password changed (the project team should do this) |

When these work, the portal is live. Tell the project team.

### Step 9 – Turn on daily backups

```bash
chmod +x /opt/rite-exam-portal/deploy/backup.sh
(crontab -l 2>/dev/null; echo "30 2 * * * /opt/rite-exam-portal/deploy/backup.sh >> /var/log/rite-exam-backup.log 2>&1") | crontab -
```
Backups are saved every night at 2:30 in `/opt/rite-exam-portal/deploy/backups/` and kept for 14 days.
Please also copy them off the server (e.g. OCI Object Storage) or rely on the database server's own backups.

---

## Part C – Everyday tasks

Run these inside `/opt/rite-exam-portal/deploy`.

| Task | Command |
|---|---|
| Is it running? | `docker compose -f docker-compose.prod.yml ps` |
| See the portal's log | `docker compose -f docker-compose.prod.yml logs -f app` (Ctrl+C to stop) |
| Restart the portal | `docker compose -f docker-compose.prod.yml restart app` |
| Install a new version | `git -C /opt/rite-exam-portal pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Stop the portal | `docker compose -f docker-compose.prod.yml down` (data stays in the database) |
| Add an admin or reset a password | `docker compose -f docker-compose.prod.yml exec app python -m app.cli create-admin name@rite.digital 'NewPass@123' Full Name` |

**Do not restart or update while a campus drive is running** – students would be interrupted.

---

## Part D – If something goes wrong

| Problem | Likely cause | What to do |
|---|---|---|
| The site does not open at all | DNS or ports | `nslookup <DOMAIN>` must show the server IP; ports 80/443 must be open in OCI **and** on the server (Step 2) |
| Browser says the certificate is not valid | Certificate missing or for another name | Check the `ssl_certificate` paths in the nginx file; rerun `sudo certbot --nginx -d <DOMAIN>` |
| "502 Bad Gateway" | nginx cannot reach the portal | `curl http://127.0.0.1:8085/api/health` on the server. If that works: on Oracle Linux run Step 7.4 (SELinux). If not: `docker compose -f docker-compose.prod.yml logs app` |
| "413 Request Entity Too Large" when uploading Excel | `client_max_body_size` missing | It must be in the portal's nginx site (`12m`); reload nginx |
| `app` keeps restarting | Usually the database | `docker compose -f docker-compose.prod.yml logs app` – check `DATABASE_URL` in `.env`, and that port 5432 is reachable (Part A, item 4) |
| "password authentication failed" in the log | Wrong database user/password in `DATABASE_URL` | Correct `.env`, then `docker compose -f docker-compose.prod.yml up -d` |
| Login says "Incorrect email or password" | Admin not created, or password changed | Reset it with the `create-admin` command in Part C |
| Students' camera does not work | The page is not on HTTPS | Always use `https://<DOMAIN>`; the camera never works on plain `http` |

Contact the project team with the output of `docker compose -f docker-compose.prod.yml logs --tail 100 app` if you are stuck.

---

## Optional

- **Server without nginx (nothing on ports 80/443):** set `DOMAIN=<domain>` in `.env` and start with
  `docker compose -f docker-compose.prod.yml --profile caddy up -d --build` – a Caddy container then handles HTTPS automatically, and Step 7 is not needed.
- **No separate database server:** leave `DATABASE_URL` out of `.env`, add `DB_PASSWORD=<random>` and start with
  `docker compose -f docker-compose.prod.yml --profile local-db up -d --build` – a PostgreSQL container then runs on the portal server.
- **Large drives (1,000+ students at once):** use a bigger server (4+ OCPU) and set `WEB_CONCURRENCY` to the number of vCPUs.

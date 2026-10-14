# Deploying on Oracle Cloud (OCI)

The portal runs as Docker containers on one Linux server, using your PostgreSQL server (or, optionally, a PostgreSQL container on the same server):

```
Students / admins ──HTTPS──▶ Caddy (ports 80/443, automatic certificate)
                               └──▶ app: Python (FastAPI) + the React website
                                       └──▶ PostgreSQL (your database server, or the local-db container)
```

You need: an OCI Compute VM, a domain name you control (e.g. `exam.rite.digital`), and SSH access.

## 1. The server

| Setting | Recommendation |
|---|---|
| Image | Oracle Linux 9 or Ubuntu 24.04 |
| Shape | 2 OCPU / 16 GB (e.g. VM.Standard.E5.Flex), or Ampere A1 4 OCPU / 24 GB |
| Boot volume | 100 GB (camera photos are about 1 MB per student) |
| Public IP | **Reserved** public IP, so it never changes |

In tests, 4 worker processes handled 500 students at once (answers saved in about 20 ms).
For bigger drives, give the VM more OCPUs and raise `WEB_CONCURRENCY`.

## 2. Network: open ports 80 and 443

**In OCI** (VCN → Security List or Network Security Group of the VM's subnet), add ingress rules:
- TCP 443 from `0.0.0.0/0` (HTTPS for students and admins)
- TCP 80 from `0.0.0.0/0` (needed for the free certificate and the redirect to HTTPS)
- TCP 22 only from your office IP (SSH)

**On the VM** (OCI images also have their own firewall):

```bash
# Oracle Linux
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload

# Ubuntu (OCI images ship with iptables rules)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. DNS

In your DNS (OCI DNS or your company's provider), create an **A record**:

```
exam.rite.digital   A   <the VM's reserved public IP>
```

Check it before continuing: `nslookup exam.rite.digital` must return that IP.

## 4. Install Docker

```bash
# Oracle Linux 9
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker

# Ubuntu 24.04
curl -fsSL https://get.docker.com | sudo sh

sudo usermod -aG docker $USER   # then log out and back in
```

## 5. Copy the project to the server

From a git repository: `git clone <repo> /opt/rite-exam-portal`.
Or copy the folder from this laptop, leaving out `node_modules`, `backend/.venv`, `dist` and `old`:

```bash
rsync -av --exclude node_modules --exclude .venv --exclude dist --exclude old ./exam-portal/ user@SERVER:/opt/rite-exam-portal/
```

## 6. Database (your PostgreSQL server)

Create a dedicated database and user for the portal (once, as a PostgreSQL admin):

```sql
CREATE USER rite_exam WITH PASSWORD 'a-strong-password';
CREATE DATABASE rite_exam OWNER rite_exam;
```

Make sure the portal server can reach the database on port 5432, and that port 5432 is **not** open to the internet:
in OCI allow it only from the portal server's IP. The app creates its tables itself on first start.

## 6b. Settings

```bash
cd /opt/rite-exam-portal/deploy
cp .env.prod.example .env
nano .env
```

Fill in `DOMAIN`, `DATABASE_URL` (`postgres://rite_exam:PASSWORD@DB_HOST:5432/rite_exam`), `JWT_SECRET` (`openssl rand -hex 32`),
`ADMIN_EMAIL` and `ADMIN_PASSWORD`. Keep this file private.

No database server? Leave `DATABASE_URL` out, set `DB_PASSWORD` and add `--profile local-db` to the start command below:
a PostgreSQL container then runs on this server.

## 7. Start

```bash
cd /opt/rite-exam-portal/deploy
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app     # Ctrl+C to stop watching
```

The first build takes a few minutes. On start-up the app creates the database tables and the first admin.
Caddy requests the HTTPS certificate on the first visit.

## 8. Check

- `https://exam.rite.digital/api/health` shows `{"ok":true}`
- `https://exam.rite.digital/admin` shows the login page; log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- Change that password under **Admins → Change my password**, then clear `ADMIN_PASSWORD` in `.env`
- Create a drive and take the test from a phone using its link (the camera works only over HTTPS)

## Everyday operations

| Task | Command (in `deploy/`) |
|---|---|
| See logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| Restart | `docker compose -f docker-compose.prod.yml restart app` |
| Update to a new version | copy/pull the new code, then `docker compose -f docker-compose.prod.yml up -d --build` |
| Add an admin / reset a password | `docker compose -f docker-compose.prod.yml exec app python -m app.cli create-admin someone@rite.digital 'NewPass@123' Their Name` |
| Stop everything | `docker compose -f docker-compose.prod.yml down` (data is kept in the volume) |

Updates are safe during quiet hours; avoid restarting while a drive is running.

## Backups

Daily database backup, kept 14 days (in `deploy/backups/`):

```bash
chmod +x /opt/rite-exam-portal/deploy/backup.sh
(crontab -l 2>/dev/null; echo "30 2 * * * /opt/rite-exam-portal/deploy/backup.sh >> /var/log/rite-exam-backup.log 2>&1") | crontab -
```

Also enable an OCI **backup policy** on the VM's boot volume, and copy `deploy/backups/` to OCI Object Storage
if you need off-server copies. The restore command is at the end of `backup.sh`.

## Options

- **Certificate from your IT team** instead of Let's Encrypt: see the comment at the top of `deploy/Caddyfile`.
- **Managed database** (OCI Database with PostgreSQL): set `DATABASE_URL` to it and `DATABASE_SSL=true`.
- **Several app servers** behind an OCI Load Balancer: possible later; each server runs the `app` container
  pointing at the same managed database.

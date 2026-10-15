# Rite Exam Portal – Backend (API)

Python 3.12 + FastAPI + PostgreSQL. Registration, the timed test (server-side timer), proctoring events and photos,
marking, admin APIs, Excel import/export and results. It creates and updates its database tables by itself on
start-up (Alembic migrations).

```
backend/
├── app/
│   ├── main.py              app setup: routes, start-up tasks (migrations, first admin, expired-test sweeper)
│   ├── server.py            production server (uvicorn, several workers)
│   ├── config.py            settings from environment variables / backend/.env
│   ├── db.py                database access (plain SQL on an asyncpg pool)
│   ├── api/routes/          public (students), attempt (taking the test), admin_* (auth, exams, drives, attempts)
│   ├── services/            marking, paper shuffling, Excel, drives, candidates
│   ├── core/                validation, errors, security, rate limits, security headers
│   ├── models/              table definitions (SQLAlchemy), used by Alembic
│   └── cli.py               create-admin, seed, migrate
├── alembic/, alembic.ini    database migrations
├── tests/                   pytest API tests
├── requirements.txt         runtime packages (requirements-dev.txt adds test tools)
├── .env.example             settings for local development
└── deploy/
    ├── rite-exam-portal.service   systemd service (production)
    ├── .env.prod.example          production settings template
    ├── update.sh                  install a new version and restart
    └── backup.sh                  daily database backup
```

## Develop

Needs Python 3.12+ and PostgreSQL 16 on port 5432 with a user `exam` (password `exam`) owning the databases
`exam`, `exam_test` (tests) and `exam_e2e` (browser tests).
```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt        # Windows: .venv\Scripts\pip
cp .env.example .env
.venv/bin/python -m app.cli seed                     # optional: sample paper + demo drive
.venv/bin/python -m uvicorn app.main:app --port 3000 --reload
.venv/bin/python -m pytest                           # tests
.venv/bin/python -m ruff check app alembic tests     # lint
```
API documentation (development only): http://localhost:3000/api/docs

## Deploy (server: Oracle Linux, PostgreSQL in the container `postgres-service`)

Runs as the systemd service `rite-exam-portal` on `172.17.0.1:8085`: reachable by the nginx container, not by
the internet. The full step-by-step guide is `../DEPLOY.md`; in short, as `opc`, with the repository cloned to
`/opt/rite-exam-portal`:
```bash
cd /opt/rite-exam-portal/backend
python3.12 -m venv .venv && .venv/bin/pip install -q -r requirements.txt
cp deploy/.env.prod.example .env && nano .env && sed -i 's/\r$//' .env && chmod 600 .env
sudo useradd --system --no-create-home --shell /sbin/nologin rite-exam 2>/dev/null
sudo restorecon -R /opt/rite-exam-portal
sudo install -m 644 deploy/rite-exam-portal.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now rite-exam-portal
curl http://172.17.0.1:8085/api/health               # {"ok":true}
```
Updates: `deploy/update.sh`. Backups: `deploy/backup.sh` (see `../DEPLOY.md`). Never update during a live drive.

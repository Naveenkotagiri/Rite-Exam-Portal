# Rite Exam Portal

Online, proctored written tests for Rite's campus drives. Students register with their details and take a timed test on their own phone or laptop, or on a college lab PC. HR sees the scores as soon as each test is submitted and publishes results back to students.

| Part | Technology |
|---|---|
| Frontend | React 19, Vite, Rite Design System (Poppins, Lucide icons) |
| Backend | Python 3.12+, FastAPI, asyncpg; SQLAlchemy models + Alembic migrations |
| Database | PostgreSQL 16 |
| Hosting | Backend: systemd service on Oracle Cloud. Frontend: static files in the nginx container (HTTPS). See [DEPLOY.md](DEPLOY.md) |

The code is split into two self-contained folders, each with its own README:

- **[frontend/](frontend/README.md)**: the whole website (React source, `package.json`, build config, nginx deploy files)
- **[backend/](backend/README.md)**: the whole API (Python source, tests, requirements, systemd service, backup)

## What it does

**Students** open the drive link or scan its QR code, then:
1. **Register:** First Name, Middle Name, Last Name, Student ID, Email, Phone Number.
   - Every field is checked.
   - The same Student ID, email or phone can't register twice for one drive.
2. **Instructions:** they turn on the camera and press **Start Test**.
3. **The test:**
   - The timer is kept by the server.
   - Questions are grouped by section, with reading passages shown above their questions.
   - Questions can be marked for review.
   - Answers save automatically and survive refreshes or a dropped connection.
4. **Submission:** by the student, when the timer ends, or automatically after leaving the window too many times.
5. **Results:** after HR publishes them, students check them on the same link. They see Shortlisted or Not selected plus HR's message; marks are never shown.

**Proctoring** (set per drive):
- Camera on, with photos taken at random times.
- Full-screen mode.
- Leaving the window is counted, with auto-submit on the Nth time.
- Copy and paste blocked.
- Questions and options shuffled per student.
- Optional Safe Exam Browser for lab PCs.
- Moving to another device only with a coordinator's approval.

**Admins** (`/admin`):
- **Exams:** create papers or upload them from Excel.
- **Drives:** link, QR code, open and close times.
- **Live monitor:** +5 min, submit, allow re-login.
- **Results:** ranking, section scores, Excel export, re-grade, publish to students.
- **Candidate page:** photos, activity log, every answer.

## Run it locally

Needs Node.js 22+, Python 3.12+ and PostgreSQL 16 running on this machine (port 5432).

Create the database user and databases once (`psql -U postgres`):
```sql
CREATE USER exam WITH PASSWORD 'exam';
CREATE DATABASE exam OWNER exam;
CREATE DATABASE exam_test OWNER exam;   -- for npm test
CREATE DATABASE exam_e2e OWNER exam;    -- for npm run test:e2e
```

```bash
npm install                 # developer tools (runs both parts together, browser tests)
npm run setup               # frontend packages + backend/.venv with the Python packages
cp backend/.env.example backend/.env    # Windows: copy backend\.env.example backend\.env
npm run seed                # optional: the sample IBS paper + a demo drive
npm run dev                 # API on :3000 (auto-reload), website on http://localhost:5173
```

Open:
- **Admin:** http://localhost:5173/admin, using `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `backend/.env`.
- **Demo test:** http://localhost:5173/d/ibs-demo
- **API documentation (development only):** http://localhost:3000/api/docs

To run the production build locally, use `npm run build && npm start` and open http://localhost:3000 (the backend serves `frontend/dist` when it runs on its own).

Each part can also be developed on its own: see [frontend/README.md](frontend/README.md) and [backend/README.md](backend/README.md).

## Tests

```bash
npm test             # 49 API tests (pytest, uses the exam_test database)
npm run lint         # ruff
npm run build
npm run test:e2e     # 17 browser tests (Playwright): student + admin flows, fake camera, offline, phone
```

A 100-student rehearsal of a live drive (rule breakers, time-ups, device switches; checks every score and prints response
times) runs against a running portal: `ADMIN_EMAIL=... ADMIN_PASSWORD=... backend/.venv/bin/python test/load/exam_simulation.py [URL]`.
See [DEPLOY.md](DEPLOY.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Backend (auto-reload) + frontend dev server |
| `npm start` | Production server (serves the built website too) |
| `npm run create-admin -- <email> <password> [name]` | Add an admin, or reset a password |
| `npm run seed` | Load the sample paper and demo drive |
| `npm run migrate` | Bring the database schema up to date (also happens on start-up) |

## Project layout

```
frontend/                 the website (React + Vite): src/, public/, package.json, deploy/ (nginx site, update.sh)
backend/                  the API (Python + FastAPI): app/, alembic/, tests/, requirements.txt, deploy/ (service, update.sh, backup.sh)
DEPLOY.md                 step-by-step server deployment (backend first, then frontend)
package.json, scripts/    developer tools: run both parts together, set up, test
test/e2e/                 Playwright browser tests (student + admin flows)
test/load/                100-student drive simulation (load + rules)
old/                      the previous Node.js backend and Azure files (unused; safe to delete)
```

## Limits to be aware of

- **A web page cannot close or block other browser tabs.** Leaving the window is detected and penalised; for a real lockdown, use Safe Exam Browser on lab PCs.
- **iPhones (Safari) do not support full-screen mode for web pages.** Camera and tab-switch detection still work there.
- **Camera photos are reviewed by people.** There is no automatic face recognition.
- **Questions are multiple choice only.**

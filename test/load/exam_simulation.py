"""Simulates a live campus drive: 100 students at once on a 2-minute test, with rule breakers and edge cases.

Usage (from the project folder; takes about 3 minutes):
    ADMIN_EMAIL=... ADMIN_PASSWORD=... backend/.venv/bin/python test/load/exam_simulation.py [BASE_URL] [--keep]
    BASE_URL defaults to http://127.0.0.1:8085 (the portal on the server itself).

Creates its own exam and drive through the admin API, runs every student concurrently like the real
browser does (answer saves, clock polling every 15 s, events, photos), then checks every candidate's
final status, submit reason, violation count and score against what the rules say should happen.
Afterwards it deletes the test drive and exam again (unless --keep). Never run it during a real drive.
"""

import asyncio
import os
import random
import statistics
import sys
import time
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

import httpx

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
KEEP = "--keep" in sys.argv
BASE = ARGS[0].rstrip("/") if ARGS else "http://127.0.0.1:8085"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
DURATION_MIN = 2
MAX_VIOLATIONS = 3
NEGATIVE = 0.25
GRACE = 30  # server's grace_seconds

random.seed(7)
latency: dict[str, list[float]] = defaultdict(list)
statuses: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
problems: list[str] = []
checks_passed = 0
client: httpx.AsyncClient


def check(ok: bool, what: str) -> None:
    global checks_passed
    if ok:
        checks_passed += 1
    else:
        problems.append(what)


async def call(name: str, method: str, path: str, token: str | None = None, **kw) -> httpx.Response:
    headers = kw.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    t = time.perf_counter()
    r = await client.request(method, path, headers=headers, **kw)
    latency[name].append((time.perf_counter() - t) * 1000)
    statuses[name][r.status_code] += 1
    if r.status_code >= 500:
        problems.append(f"{name}: HTTP {r.status_code} {r.text[:200]}")
    return r


# ---------------------------------------------------------------- admin

class Admin:
    token = ""

    async def login(self) -> None:
        r = await call("admin login", "POST", "/api/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        r.raise_for_status()
        self.token = r.json()["token"]

    async def req(self, name: str, method: str, path: str, **kw) -> httpx.Response:
        return await call(name, method, path, self.token, **kw)


admin = Admin()
KEY: dict[int, int] = {}     # question id → correct option index
MARKS: dict[int, float] = {}


async def setup() -> dict:
    await admin.login()
    stamp = datetime.now().strftime("%H%M%S")
    exam = (await admin.req("admin create", "POST", "/api/admin/exams",
                            json={"title": f"Load test {stamp}", "durationMin": DURATION_MIN, "negativeMarks": NEGATIVE,
                                  "instructions": "Simulated drive."})).json()
    sections = []
    for name in ("Aptitude", "English"):
        sections.append((await admin.req("admin create", "POST", f"/api/admin/exams/{exam['id']}/sections", json={"name": name})).json())
    for i in range(10):
        sec = sections[0] if i < 6 else sections[1]
        marks = 1 if i < 6 else 2
        q = (await admin.req("admin create", "POST", f"/api/admin/exams/{exam['id']}/questions",
                             json={"sectionId": sec["id"], "text": f"Question {i + 1}?", "options": ["A", "B", "C", "D"],
                                   "correctIndex": i % 4, "marks": marks})).json()
        KEY[q["id"]], MARKS[q["id"]] = i % 4, marks
    now = datetime.now(UTC)
    drive = (await admin.req("admin create", "POST", "/api/admin/drives",
                             json={"name": f"Load drive {stamp}", "college": "Simulation College", "examId": exam["id"],
                                   "code": f"load-{stamp}", "driveDate": date.today().isoformat(),
                                   "opensAt": (now - timedelta(hours=1)).isoformat(), "closesAt": (now + timedelta(hours=3)).isoformat(),
                                   "maxViolations": MAX_VIOLATIONS, "cameraRequired": True, "requireFullscreen": True,
                                   "shuffleQuestions": True, "shuffleOptions": True})).json()
    return drive


async def attempt_id_of(drive_id: int, student_code: str) -> int:
    r = await admin.req("admin monitor", "GET", f"/api/admin/drives/{drive_id}/attempts")
    return next(a["id"] for a in r.json()["attempts"] if a["student_code"] == student_code)


# ---------------------------------------------------------------- students

FAKE_JPEG = b"\xff\xd8\xff\xe0" + os.urandom(20_000) + b"\xff\xd9"


class Student:
    def __init__(self, n: int, scenario: str, drive: dict):
        self.n, self.scenario, self.drive = n, scenario, drive
        self.code = f"LT{n:04d}"
        self.profile = {"firstName": f"Student{chr(65 + n % 26)}", "lastName": "Tester", "studentId": self.code,
                        "email": f"student{n}@sim.test", "phone": f"9{n:09d}"}
        self.token = ""
        self.questions: list[dict] = []
        self.ends_at: datetime | None = None
        self.chosen: dict[int, int] = {}   # question id → option the student ended up with
        self.expected_reason = "student"
        self.expected_violations = 0
        self.active = True

    # --- helpers
    async def register(self, name: str = "register") -> httpx.Response:
        return await call(name, "POST", f"/api/drives/{self.drive['code']}/register", json=self.profile)

    async def start(self) -> None:
        r = await call("start", "POST", "/api/attempt/start", self.token)
        check(r.status_code == 200, f"{self.code}: start → {r.status_code} {r.text[:120]}")
        s = r.json()
        self.questions = s["questions"]
        self.ends_at = datetime.fromisoformat(s["endsAt"])
        check(len(self.questions) == 10, f"{self.code}: paper has {len(self.questions)} questions")

    async def answer(self, q: dict, correct: bool, token: str | None = None) -> httpx.Response:
        key = KEY[q["id"]] if correct else (KEY[q["id"]] + 1) % 4
        r = await call("save answer", "POST", "/api/attempt/answers", token or self.token,
                       json={"answers": [{"questionId": q["id"], "selected": key, "review": False}]})
        if r.status_code == 200:
            self.chosen[q["id"]] = key
        return r

    async def event(self, type_: str) -> httpx.Response:
        return await call("event", "POST", "/api/attempt/events", self.token, json={"type": type_, "detail": "simulated"})

    async def snapshot(self) -> httpx.Response:
        return await call("snapshot", "POST", "/api/attempt/snapshot", self.token, content=FAKE_JPEG, headers={"Content-Type": "image/jpeg"})

    async def submit(self) -> httpx.Response:
        r = await call("submit", "POST", "/api/attempt/submit", self.token)
        check(r.status_code == 200, f"{self.code}: submit → {r.status_code} {r.text[:120]}")
        self.active = False
        return r

    async def poll_clock(self) -> None:
        """The test page re-syncs its clock every 15 seconds."""
        while self.active:
            await asyncio.sleep(15 + random.uniform(-2, 2))
            if not self.active:
                return
            r = await call("clock poll", "GET", "/api/attempt/clock", self.token)
            if r.status_code == 200 and r.json()["status"] == "submitted":
                self.active = False

    async def wait_until(self, moment: datetime) -> None:
        await asyncio.sleep(max(0.0, (moment - datetime.now(UTC)).total_seconds()))

    def expected_score(self) -> float:
        score = 0.0
        for qid, sel in self.chosen.items():
            score += MARKS[qid] if sel == KEY[qid] else -NEGATIVE
        return round(score, 2)

    # --- scenarios
    async def run(self) -> None:
        try:
            await self._run()
        except Exception as err:  # noqa: BLE001 - report and keep the other students going
            problems.append(f"{self.code} ({self.scenario}): crashed: {type(err).__name__}: {err}")

    async def _run(self) -> None:
        r = await self.register()
        check(r.status_code == 201, f"{self.code}: register → {r.status_code} {r.text[:120]}")
        if r.status_code != 201:
            return
        self.token = r.json()["token"]
        await asyncio.sleep(random.uniform(0, 5))  # reading the instructions
        if self.scenario == "refresh_resume":  # opens the link again before pressing Start
            r = await self.register("register again")
            check(r.status_code == 200 and r.json()["resumed"], f"{self.code}: re-register before start → {r.status_code}")
            self.token = r.json()["token"]
        await self.start()
        poller = asyncio.create_task(self.poll_clock())
        try:
            await getattr(self, self.scenario)()
        finally:
            self.active = False
            poller.cancel()

    async def honest(self) -> None:
        k = self.n % 11  # how many this student gets right: a spread of scores
        for i, q in enumerate(self.questions):
            await asyncio.sleep(random.uniform(2, 5))
            r = await self.answer(q, correct=i < k)
            check(r.status_code == 200, f"{self.code}: answer → {r.status_code}")
            if i == 4:
                await self.snapshot()
        await asyncio.sleep(random.uniform(0, 20))
        await self.submit()

    async def violator_autosubmit(self) -> None:
        for q in self.questions[:3]:
            await asyncio.sleep(random.uniform(2, 4))
            await self.answer(q, correct=True)
        for v in range(1, MAX_VIOLATIONS + 1):
            await asyncio.sleep(random.uniform(3, 6))
            r = (await self.event("left_window")).json()
            check(r["violations"] == v, f"{self.code}: violation count {r['violations']} ≠ {v}")
            check(r["submitted"] == (v == MAX_VIOLATIONS), f"{self.code}: auto-submit after {v} violations = {r['submitted']}")
        r = await self.answer(self.questions[5], correct=True)
        check(r.status_code == 409, f"{self.code}: answer after auto-submit → {r.status_code} (want 409)")
        self.expected_reason, self.expected_violations = "violations", MAX_VIOLATIONS

    async def minor_violations(self) -> None:
        for i, q in enumerate(self.questions):
            await asyncio.sleep(random.uniform(2, 4))
            await self.answer(q, correct=True)
            if i in (2, 6):
                r = (await self.event("left_window")).json()
                check(not r["submitted"], f"{self.code}: submitted after only {r['violations']} violations")
            if i == 3:
                for t in ("fullscreen_exit", "copy_blocked", "paste_blocked", "camera_off", "camera_on", "offline", "online"):
                    r = await self.event(t)
                    check(r.status_code == 200 and r.json()["violations"] == 1, f"{self.code}: info event {t} counted as violation")
        await self.submit()
        self.expected_violations = 2

    async def time_up_idle(self) -> None:
        """Answers half the paper, then closes the tab and never comes back: the server must submit it."""
        for q in self.questions[:5]:
            await asyncio.sleep(random.uniform(2, 5))
            await self.answer(q, correct=True)
        self.expected_reason = "time_up"

    async def time_up_late(self) -> None:
        """Still answering when the timer hits zero (slow network)."""
        for q in self.questions[:4]:
            await asyncio.sleep(random.uniform(2, 5))
            await self.answer(q, correct=True)
        in_grace = self.n % 5 < 3
        await self.wait_until(self.ends_at + timedelta(seconds=8 if in_grace else GRACE + 8))
        r = await self.answer(self.questions[4], correct=True)
        if in_grace:
            check(r.status_code == 200, f"{self.code}: answer inside grace period → {r.status_code} (want 200)")
            await self.submit()
        else:
            check(r.status_code == 409, f"{self.code}: answer after grace period → {r.status_code} (want 409)")
        self.expected_reason = "time_up"

    async def device_switch(self) -> None:
        """Phone battery dies mid-test; the student continues on a lab PC with the coordinator's approval."""
        for q in self.questions[:2]:
            await asyncio.sleep(random.uniform(2, 4))
            await self.answer(q, correct=True)
        old = self.token
        r = await self.register("register again")
        check(r.status_code == 409 and r.json().get("reloginPending"), f"{self.code}: new device without approval → {r.status_code} (want 409)")
        await asyncio.sleep(random.uniform(3, 8))  # coordinator walks over
        aid = await attempt_id_of(self.drive["id"], self.code)
        r = await admin.req("admin approve relogin", "POST", f"/api/admin/attempts/{aid}/allow-relogin")
        check(r.status_code == 204, f"{self.code}: allow-relogin → {r.status_code}")
        r = await self.register("register again")
        check(r.status_code == 200 and r.json()["resumed"], f"{self.code}: new device after approval → {r.status_code}")
        self.token = r.json()["token"]
        r = await call("clock poll", "GET", "/api/attempt/clock", old)
        check(r.status_code == 401, f"{self.code}: old device still works → {r.status_code} (want 401)")
        s = (await call("load state", "GET", "/api/attempt", self.token)).json()
        check(len(s["answers"]) == 2, f"{self.code}: {len(s['answers'])} answers survived the device switch (want 2)")
        for q in self.questions[2:]:
            await asyncio.sleep(random.uniform(1, 3))
            await self.answer(q, correct=True)
        await self.submit()

    async def coordinator_submit(self) -> None:
        """Caught with a phone: the coordinator submits the test from the monitor."""
        for q in self.questions[:3]:
            await asyncio.sleep(random.uniform(2, 4))
            await self.answer(q, correct=True)
        aid = await attempt_id_of(self.drive["id"], self.code)
        r = await admin.req("admin force submit", "POST", f"/api/admin/attempts/{aid}/submit")
        check(r.status_code == 204, f"{self.code}: coordinator submit → {r.status_code}")
        r = await call("clock poll", "GET", "/api/attempt/clock", self.token)
        check(r.json()["submitReason"] == "coordinator", f"{self.code}: clock shows {r.json()['submitReason']}")
        r = await self.answer(self.questions[4], correct=True)
        check(r.status_code == 409, f"{self.code}: answer after coordinator submit → {r.status_code} (want 409)")
        self.expected_reason = "coordinator"

    async def extended_time(self) -> None:
        """Joined late because of a power cut: the coordinator adds 1 minute."""
        aid = await attempt_id_of(self.drive["id"], self.code)
        r = await admin.req("admin extend", "POST", f"/api/admin/attempts/{aid}/extend", json={"minutes": 1})
        check(r.status_code == 204, f"{self.code}: extend → {r.status_code}")
        r = (await call("clock poll", "GET", "/api/attempt/clock", self.token)).json()
        new_end = datetime.fromisoformat(r["endsAt"])
        check(abs((new_end - self.ends_at).total_seconds() - 60) < 1, f"{self.code}: end moved by {(new_end - self.ends_at).total_seconds()} s")
        for q in self.questions[:5]:
            await asyncio.sleep(random.uniform(2, 4))
            await self.answer(q, correct=True)
        await self.wait_until(self.ends_at + timedelta(seconds=GRACE + 10))  # past the ORIGINAL end and its grace
        for q in self.questions[5:]:
            r = await self.answer(q, correct=True)
            check(r.status_code == 200, f"{self.code}: answer in extra minute → {r.status_code} (want 200)")
        await self.submit()

    async def refresh_resume(self) -> None:
        """Refreshes the page mid-test: answers and timer must come back unchanged."""
        for q in self.questions[:4]:
            await asyncio.sleep(random.uniform(2, 4))
            await self.answer(q, correct=True)
        s = (await call("load state", "GET", "/api/attempt", self.token)).json()
        check(len(s["answers"]) == 4, f"{self.code}: {len(s['answers'])} answers after refresh (want 4)")
        check(datetime.fromisoformat(s["endsAt"]) == self.ends_at, f"{self.code}: timer changed after refresh")
        check([q["id"] for q in s["questions"]] == [q["id"] for q in self.questions], f"{self.code}: question order changed after refresh")
        for q in self.questions[4:]:
            await asyncio.sleep(random.uniform(1, 3))
            await self.answer(q, correct=False)
        await self.submit()

    async def tamper(self) -> None:
        """Edits requests by hand to cheat."""
        q = self.questions[0]
        r = await call("tamper", "POST", "/api/attempt/answers", self.token, json={"answers": [{"questionId": q["id"], "selected": 9}]})
        check(r.status_code == 400, f"{self.code}: invalid option accepted → {r.status_code}")
        r = await call("tamper", "POST", "/api/attempt/answers", self.token, json={"answers": [{"questionId": 99999999, "selected": 0}]})
        check(r.status_code == 400, f"{self.code}: unknown question accepted → {r.status_code}")
        r = await call("tamper", "POST", "/api/attempt/events", self.token, json={"type": "reset_violations"})
        check(r.status_code == 400, f"{self.code}: unknown event accepted → {r.status_code}")
        r = await call("tamper", "POST", "/api/attempt/snapshot", self.token, content=b"not a photo" * 20, headers={"Content-Type": "image/jpeg"})
        check(r.status_code == 400, f"{self.code}: fake photo accepted → {r.status_code}")
        r = await call("tamper", "GET", "/api/admin/drives", self.token)
        check(r.status_code == 401, f"{self.code}: student token opened admin API → {r.status_code}")
        for i, q in enumerate(self.questions):
            await asyncio.sleep(random.uniform(1, 3))
            await self.answer(q, correct=i % 2 == 0)
        await self.submit()
        r = await self.register("register again")
        check(r.status_code == 409, f"{self.code}: register after submitting → {r.status_code} (want 409)")
        r = await self.answer(self.questions[1], correct=True)
        check(r.status_code == 409, f"{self.code}: answer after submitting → {r.status_code} (want 409)")


async def bad_registrations(drive: dict, taken: Student) -> None:
    """People who cannot get in: duplicates and invalid details."""
    url = f"/api/drives/{drive['code']}/register"
    await asyncio.sleep(3)  # after the real student has registered
    for i in range(5):  # someone else's phone number / email / Student ID
        p = dict(taken.profile, studentId=f"DUP{i:03d}", email=f"dup{i}@sim.test")
        r = await call("register (bad)", "POST", url, json=p)
        check(r.status_code == 409 and "phone" in r.json().get("fields", {}), f"duplicate phone #{i} → {r.status_code}")
    invalid = [
        {"firstName": "", "lastName": "X", "studentId": "AB1", "email": "a@b.co", "phone": "9876543210"},
        {"firstName": "Ravi", "lastName": "K", "studentId": "AB2", "email": "not-an-email", "phone": "9876543211"},
        {"firstName": "Ravi", "lastName": "K", "studentId": "AB3", "email": "r@b.co", "phone": "12345"},
        {"firstName": "R4v1", "lastName": "K", "studentId": "AB4", "email": "r4@b.co", "phone": "9876543212"},
        {"firstName": "Ravi", "lastName": "K", "studentId": "!", "email": "r5@b.co", "phone": "9876543213"},
    ]
    for i, p in enumerate(invalid):
        r = await call("register (bad)", "POST", url, json=p)
        check(r.status_code == 400, f"invalid registration #{i} → {r.status_code} (want 400)")


SCENARIOS = [("honest", 35), ("violator_autosubmit", 15), ("minor_violations", 10), ("time_up_idle", 10), ("time_up_late", 5),
             ("device_switch", 5), ("coordinator_submit", 5), ("extended_time", 5), ("refresh_resume", 5), ("tamper", 5)]


async def main() -> None:
    global client
    if not ADMIN_EMAIL or not ADMIN_PASSWORD:
        sys.exit("Set ADMIN_EMAIL and ADMIN_PASSWORD to an admin login of the portal you are testing.")
    client = httpx.AsyncClient(base_url=BASE, timeout=60, limits=httpx.Limits(max_connections=300, max_keepalive_connections=300))
    t0 = time.perf_counter()
    drive = await setup()
    print(f"Drive {drive['code']}: {DURATION_MIN}-minute test, 10 questions, auto-submit after {MAX_VIOLATIONS} tab switches")

    students, n = [], 0
    for scenario, count in SCENARIOS:
        for _ in range(count):
            n += 1
            students.append(Student(n, scenario, drive))
    random.shuffle(students)
    print(f"Starting {len(students)} students at the same moment …")
    await asyncio.gather(*(s.run() for s in students), bad_registrations(drive, students[0]))
    print(f"All students finished their actions after {time.perf_counter() - t0:.0f} s; waiting for the server to submit abandoned tests …")

    # The server's sweeper submits tests whose time ran out (every 20 s, after the 30 s grace).
    deadline = time.time() + 240
    while time.time() < deadline:
        rows = (await admin.req("admin monitor", "GET", f"/api/admin/drives/{drive['id']}/attempts")).json()["attempts"]
        left = [r for r in rows if r["status"] != "submitted"]
        if not left:
            break
        await asyncio.sleep(5)
    print(f"All tests submitted after {time.perf_counter() - t0:.0f} s. Checking every candidate …")

    by_code = {r["student_code"]: r for r in rows}
    check(len(rows) == 100, f"{len(rows)} candidates registered (want 100)")
    reasons, per_scenario = defaultdict(int), defaultdict(lambda: [0, 0])
    for s in students:
        r = by_code.get(s.code)
        if not r:
            problems.append(f"{s.code}: missing from monitor")
            continue
        ok = (r["status"] == "submitted" and r["submit_reason"] == s.expected_reason and r["violations"] == s.expected_violations
              and abs((r["score"] or 0) - s.expected_score()) < 0.001 and r["answered"] == len(s.chosen))
        check(ok, f"{s.code} ({s.scenario}): status={r['status']} reason={r['submit_reason']} (want {s.expected_reason}) "
                  f"violations={r['violations']} (want {s.expected_violations}) score={r['score']} (want {s.expected_score()}) "
                  f"answered={r['answered']} (want {len(s.chosen)})")
        reasons[r["submit_reason"]] += 1
        per_scenario[s.scenario][0 if ok else 1] += 1

    # Results day: publish with a 50 % cutoff, students check their result, export to Excel, close the drive.
    r = await admin.req("admin publish", "POST", f"/api/admin/drives/{drive['id']}/publish",
                        json={"cutoffPct": 50, "nextSteps": "Interview on Monday.", "otherMessage": ""})
    pub = r.json()
    max_score = 14
    want_short = sum(1 for s in students if s.expected_score() * 100 / max_score >= 50)
    check(pub["shortlisted"] == want_short, f"publish: {pub['shortlisted']} shortlisted (want {want_short})")
    for s in students[:10]:
        r = await call("check result", "POST", f"/api/drives/{drive['code']}/result", json={"studentId": s.code, "phone": s.profile["phone"]})
        want = "shortlisted" if s.expected_score() * 100 / max_score >= 50 else "not_selected"
        check(r.status_code == 200 and r.json()["status"] == want and "score" not in r.json(), f"{s.code}: result {r.text[:100]} (want {want})")
    r = await call("check result", "POST", f"/api/drives/{drive['code']}/result", json={"studentId": students[0].code, "phone": "9999999999"})
    check(r.status_code == 404, f"result with wrong phone → {r.status_code} (want 404)")
    r = await admin.req("admin export", "GET", f"/api/admin/drives/{drive['id']}/results.xlsx")
    check(r.status_code == 200 and r.content[:2] == b"PK", f"Excel export → {r.status_code}")
    await admin.req("admin close drive", "POST", f"/api/admin/drives/{drive['id']}/open", json={"isOpen": False})
    late = dict(students[0].profile, studentId="LATE001", email="late@sim.test", phone="8888888888")
    r = await call("register (bad)", "POST", f"/api/drives/{drive['code']}/register", json=late)
    check(r.status_code == 403, f"register after drive closed → {r.status_code} (want 403)")
    if KEEP:
        print(f"\nKept the test drive '{drive['name']}' and its exam (--keep).")
    else:  # leave nothing behind on a real server
        await admin.req("admin cleanup", "DELETE", f"/api/admin/drives/{drive['id']}")
        r = await admin.req("admin cleanup", "DELETE", f"/api/admin/exams/{drive['exam_id']}")
        check(r.status_code == 204, f"cleanup: delete test exam → {r.status_code}")
        print("\nRemoved the test drive, its 100 test candidates and the test exam.")
    await client.aclose()

    # ---- report
    print("\n=== Scenarios (students: passed / failed) ===")
    for scenario, _ in SCENARIOS:
        ok, bad = per_scenario[scenario]
        print(f"  {scenario:<22} {ok:>3} passed  {bad:>3} failed")
    print("\n=== How tests were submitted ===")
    for k, v in sorted(reasons.items()):
        print(f"  {k:<12} {v}")
    print(f"\n=== Results published (cutoff 50 %) ===\n  shortlisted {pub['shortlisted']}, not selected {pub['not_selected']}")
    print("\n=== Response times (ms) ===")
    print(f"  {'request':<22}{'count':>7}{'median':>9}{'p95':>9}{'max':>9}   HTTP status codes")
    total = 0
    for name, xs in sorted(latency.items(), key=lambda kv: -len(kv[1])):
        total += len(xs)
        xs_sorted = sorted(xs)
        p95 = xs_sorted[max(0, int(len(xs_sorted) * 0.95) - 1)]
        codes = ", ".join(f"{c}×{k}" for c, k in sorted(statuses[name].items()))
        print(f"  {name:<22}{len(xs):>7}{statistics.median(xs):>9.0f}{p95:>9.0f}{max(xs):>9.0f}   {codes}")
    server_errors = sum(k for d in statuses.values() for c, k in d.items() if c >= 500)
    print(f"\n  {total} requests, {server_errors} server errors (5xx)")
    print(f"\n=== Checks: {checks_passed} passed, {len(problems)} failed ===")
    for p in problems[:40]:
        print("  ✗", p)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    asyncio.run(main())

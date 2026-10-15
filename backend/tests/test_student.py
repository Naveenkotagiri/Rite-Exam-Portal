"""Students: drive link, registration, taking the test, timing, proctoring."""

from datetime import datetime

import pytest

from app import db
from app.services.grading import sweep_expired
from tests.conftest import auth, make_drive, make_exam, register, student


@pytest.fixture
async def exam():
    e = await make_exam()
    await make_drive(e["exam_id"])
    return e


async def start_test(api, token: str) -> dict:
    r = await api.post("/api/attempt/start", headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()


def answer(api, token: str, question_id, selected, review: bool = False):
    """Answers using the original option index (the `key` the browser sends back)."""
    return api.post("/api/attempt/answers", headers=auth(token), json={"answers": [{"questionId": question_id, "selected": selected, "review": review}]})


async def first(sql: str, **params):
    return await db.one(sql, **params)


# ---- drive link ----

async def test_drive_info_without_answers(api, exam):
    r = await api.get("/api/drives/TEST-DRIVE")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "open"
    assert body["questionCount"] == 5
    assert body["proctoring"]["cameraRequired"] is True
    assert body["proctoring"]["maxViolations"] == 3


async def test_unknown_link_is_404(api, exam):
    assert (await api.get("/api/drives/nope")).status_code == 404


# ---- registration ----

async def test_invalid_fields_get_messages(api, exam):
    r = await api.post("/api/drives/test-drive/register", json={"firstName": "", "lastName": "R4o", "studentId": "!", "email": "bad", "phone": "12345"})
    assert r.status_code == 400
    assert sorted(r.json()["fields"]) == ["email", "firstName", "lastName", "phone", "studentId"]


async def test_normalizes_phone_and_email(api, exam):
    r = await api.post("/api/drives/test-drive/register", json=student(email="Mixed@College.EDU", phone="+91 98765 43210"))
    assert r.status_code == 201
    s = await first("SELECT email, phone FROM students")
    assert (s["email"], s["phone"]) == ("mixed@college.edu", "9876543210")


async def test_reused_email_is_refused(api, exam):
    s = (await register(api))["student"]
    r = await api.post("/api/drives/test-drive/register", json=student(email=s["email"]))
    assert r.status_code == 409
    assert "email" in r.json()["fields"]


async def test_before_starting_another_device_takes_over(api, exam):
    reg = await register(api)
    r = await api.post("/api/drives/test-drive/register", json=reg["student"])
    assert r.status_code == 200 and r.json()["resumed"] is True
    assert (await api.get("/api/attempt", headers=auth(reg["token"]))).status_code == 401
    assert (await api.get("/api/attempt", headers=auth(r.json()["token"]))).status_code == 200


async def test_after_starting_another_device_needs_one_time_approval(api, exam):
    reg = await register(api)
    token, s = reg["token"], reg["student"]
    await start_test(api, token)
    assert (await answer(api, token, exam["question_ids"][0], 1)).status_code == 200

    blocked = await api.post("/api/drives/test-drive/register", json=s)
    assert blocked.status_code == 409 and blocked.json()["reloginPending"] is True
    assert (await api.get("/api/attempt", headers=auth(token))).status_code == 200
    assert (await first("SELECT relogin_requested_at FROM attempts"))["relogin_requested_at"]

    await db.run("UPDATE attempts SET relogin_allowed_until = now() - interval '1 minute'")
    assert (await api.post("/api/drives/test-drive/register", json=s)).status_code == 409

    await db.run("UPDATE attempts SET relogin_allowed_until = now() + interval '10 minutes'")
    ok = await api.post("/api/drives/test-drive/register", json=s)
    assert ok.status_code == 200
    assert (await api.get("/api/attempt", headers=auth(token))).status_code == 401
    state = (await api.get("/api/attempt", headers=auth(ok.json()["token"]))).json()
    assert state["status"] == "in_progress"
    assert state["answers"][str(exam["question_ids"][0])]["selected"] == 1

    assert (await api.post("/api/drives/test-drive/register", json=s)).status_code == 409
    events = [e["type"] for e in await db.all("SELECT type FROM attempt_events ORDER BY id")]
    assert events == ["started", "relogin_blocked", "relogin_blocked", "resumed", "relogin_blocked"]


async def test_closed_and_not_yet_open_drives_refuse_new_students(api, exam):
    await db.run("UPDATE drives SET is_open = false")
    assert (await api.post("/api/drives/test-drive/register", json=student())).status_code == 403
    await db.run("UPDATE drives SET is_open = true, opens_at = now() + interval '1 hour'")
    assert (await api.post("/api/drives/test-drive/register", json=student())).status_code == 403


# ---- taking the test ----

async def test_start_returns_paper_without_answers_and_keeps_passages_together(api, exam):
    token = (await register(api))["token"]
    state = await start_test(api, token)
    assert state["status"] == "in_progress"
    assert len(state["questions"]) == 5
    assert "correct" not in str(state)
    passage_positions = [i for i, q in enumerate(state["questions"]) if q["passage"]]
    assert passage_positions == [3, 4]
    remaining = datetime.fromisoformat(state["endsAt"]) - datetime.fromisoformat(state["serverNow"])
    # endsAt comes from the database clock and serverNow from Python's, so allow a little clock jitter.
    assert 59 * 60 < remaining.total_seconds() <= 60 * 60 + 1


async def test_start_twice_keeps_same_paper(api, exam):
    token = (await register(api))["token"]
    a = await start_test(api, token)
    b = await start_test(api, token)
    assert [q["id"] for q in b["questions"]] == [q["id"] for q in a["questions"]]
    assert b["endsAt"] == a["endsAt"]


async def test_saves_answers_grades_on_submit_and_locks(api, exam):
    reg = await register(api)
    token = reg["token"]
    await start_test(api, token)
    q1, q2, q3, q4, _ = exam["question_ids"]
    assert (await answer(api, token, q1, 1)).status_code == 200  # correct
    assert (await answer(api, token, q2, 3)).status_code == 200  # wrong
    assert (await answer(api, token, q3, 1, True)).status_code == 200  # correct, marked for review
    assert (await answer(api, token, q4, 2)).status_code == 200  # correct
    assert (await answer(api, token, q4, 9)).status_code == 400
    assert (await answer(api, token, 999999, 0)).status_code == 400

    state = (await api.get("/api/attempt", headers=auth(token))).json()
    assert state["answers"][str(q3)] == {"selected": 1, "review": True}

    assert (await api.post("/api/attempt/submit", headers=auth(token))).status_code == 200
    a = await first("SELECT status, score, max_score, section_scores, submit_reason FROM attempts")
    assert (a["status"], a["score"], a["max_score"], a["submit_reason"]) == ("submitted", 3, 5, "student")
    assert [(s["name"], s["score"], s["attempted"]) for s in a["section_scores"]] == [("Synonyms", 2, 3), ("Reading", 1, 1)]

    assert (await answer(api, token, q1, 0)).status_code == 409
    after = (await api.get("/api/attempt", headers=auth(token))).json()
    assert after["status"] == "submitted" and "questions" not in after
    s = reg["student"]
    again = await api.post("/api/drives/test-drive/register", json={**s, "middleName": ""})
    assert again.status_code == 409


async def test_negative_marking_only_for_wrong_answers(api):
    e = await make_exam(negative_marks=0.25)
    await make_drive(e["exam_id"])
    token = (await register(api))["token"]
    await start_test(api, token)
    await answer(api, token, e["question_ids"][0], 1)  # +1
    await answer(api, token, e["question_ids"][1], 2)  # -0.25
    await api.post("/api/attempt/submit", headers=auth(token))
    assert (await first("SELECT score FROM attempts"))["score"] == 0.75


async def test_time_running_out_submits(api, exam):
    token = (await register(api))["token"]
    await start_test(api, token)
    await answer(api, token, exam["question_ids"][0], 1)
    await db.run("UPDATE attempts SET ends_at = now() - interval '2 minutes'")
    assert (await answer(api, token, exam["question_ids"][1], 0)).status_code == 409
    a = await first("SELECT status, submit_reason, score FROM attempts")
    assert (a["status"], a["submit_reason"], a["score"]) == ("submitted", "time_up", 1)


async def test_sweeper_submits_abandoned_tests(api, exam):
    token = (await register(api))["token"]
    await start_test(api, token)
    await db.run("UPDATE attempts SET ends_at = now() - interval '5 minutes'")
    assert await sweep_expired() == 1
    a = await first("SELECT status, submit_reason FROM attempts")
    assert (a["status"], a["submit_reason"]) == ("submitted", "time_up")


async def test_clock_shows_extra_time_and_coordinator_submit(api, exam):
    token = (await register(api))["token"]
    state = await start_test(api, token)
    before = (await api.get("/api/attempt/clock", headers=auth(token))).json()
    assert before["status"] == "in_progress" and before["endsAt"] == state["endsAt"]
    await db.run("UPDATE attempts SET ends_at = ends_at + interval '5 minutes'")
    after = (await api.get("/api/attempt/clock", headers=auth(token))).json()
    assert (datetime.fromisoformat(after["endsAt"]) - datetime.fromisoformat(before["endsAt"])).total_seconds() == 300
    await db.run("UPDATE attempts SET status = 'submitted', submit_reason = 'coordinator'")
    done = (await api.get("/api/attempt/clock", headers=auth(token))).json()
    assert (done["status"], done["submitReason"]) == ("submitted", "coordinator")


async def test_submit_after_timer_is_time_up(api, exam):
    token = (await register(api))["token"]
    await start_test(api, token)
    await db.run("UPDATE attempts SET ends_at = now() - interval '5 seconds'")
    assert (await api.post("/api/attempt/submit", headers=auth(token))).status_code == 200
    assert (await first("SELECT submit_reason FROM attempts"))["submit_reason"] == "time_up"


async def test_grace_period_accepts_late_answers(api, exam):
    token = (await register(api))["token"]
    await start_test(api, token)
    await db.run("UPDATE attempts SET ends_at = now() - interval '10 seconds'")
    assert (await answer(api, token, exam["question_ids"][0], 1)).status_code == 200


# ---- proctoring ----

async def test_leaving_window_three_times_auto_submits(api, exam):
    token = (await register(api))["token"]
    await start_test(api, token)

    async def send(type_: str):
        return await api.post("/api/attempt/events", headers=auth(token), json={"type": type_})

    r = await send("fullscreen_exit")
    assert r.json() == {"violations": 0, "maxViolations": 3, "submitted": False}
    assert (await send("left_window")).json()["violations"] == 1
    assert (await send("left_window")).json()["submitted"] is False
    assert (await send("left_window")).json() == {"violations": 3, "maxViolations": 3, "submitted": True}
    a = await first("SELECT status, submit_reason FROM attempts")
    assert (a["status"], a["submit_reason"]) == ("submitted", "violations")
    assert (await send("bogus")).status_code == 409


async def test_zero_max_violations_never_auto_submits(api, exam):
    await db.run("UPDATE drives SET max_violations = 0")
    token = (await register(api))["token"]
    await start_test(api, token)
    for _ in range(5):
        assert (await api.post("/api/attempt/events", headers=auth(token), json={"type": "left_window"})).status_code == 200
    a = await first("SELECT status, violations FROM attempts")
    assert (a["status"], a["violations"]) == ("in_progress", 5)


async def test_only_jpeg_snapshots(api, exam):
    token = (await register(api))["token"]
    await start_test(api, token)
    jpeg = b"\xff\xd8\xff\xe0" + bytes(200)
    headers = {**auth(token), "Content-Type": "image/jpeg"}
    assert (await api.post("/api/attempt/snapshot", headers=headers, content=jpeg)).status_code == 201
    assert (await api.post("/api/attempt/snapshot", headers=headers, content=bytes(200))).status_code == 400
    assert (await api.post("/api/attempt/snapshot", headers=headers, content=b"\xff\xd8" + bytes(500 * 1024))).status_code == 413
    assert await db.value("SELECT count(*) FROM snapshots") == 1


async def test_safe_exam_browser_can_be_required(api, exam):
    await db.run("UPDATE drives SET require_seb = true")
    token = (await register(api))["token"]
    r = await api.post("/api/attempt/start", headers={**auth(token), "User-Agent": "Mozilla/5.0 Chrome/130"})
    assert r.status_code == 403
    r = await api.post("/api/attempt/start", headers={**auth(token), "User-Agent": "Mozilla/5.0 Chrome/130 SEB/3.8"})
    assert r.status_code == 200

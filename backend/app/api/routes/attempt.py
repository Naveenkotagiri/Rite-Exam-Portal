"""Taking the test. Every route needs the student's session token."""

import json
import math
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app import db
from app.api.deps import current_attempt, json_body, read_body, user_agent
from app.config import settings
from app.core.errors import HttpError, bad_request, conflict
from app.core.forms import to_number
from app.services.attempts import attempt_state, log_event, require_in_progress
from app.services.drives import DRIVE_SQL, STATUS_MESSAGE, drive_status
from app.services.grading import finalize_attempt
from app.services.paper import build_paper

router = APIRouter(prefix="/api/attempt", tags=["test"])

SNAPSHOT_LIMIT = 400 * 1024
# Events that count towards auto-submission vs. ones that are only recorded for the coordinator.
VIOLATION_EVENTS = {"left_window"}
INFO_EVENTS = {"fullscreen_exit", "camera_off", "camera_on", "copy_blocked", "paste_blocked", "offline", "online"}


def _whole(value: Any) -> int | None:
    n = to_number(value)
    return int(n) if math.isfinite(n) and n.is_integer() else None


@router.get("")
async def state(attempt: dict = Depends(current_attempt)) -> dict[str, Any]:
    return await attempt_state(attempt)


@router.get("/clock")
async def clock(attempt: dict = Depends(current_attempt)) -> dict[str, Any]:
    """Polled by the test page so it notices extra time or a coordinator's submit without a reload."""
    return {"status": attempt["status"], "endsAt": attempt["ends_at"], "serverNow": datetime.now(UTC), "submitReason": attempt["submit_reason"]}


@router.post("/start")
async def start(request: Request, attempt: dict = Depends(current_attempt)) -> dict[str, Any]:
    a = attempt
    if a["status"] == "submitted":
        raise conflict("You have already submitted this test.", submitted=True)
    if a["status"] == "registered":
        d = await db.one(f"{DRIVE_SQL} JOIN students st ON st.drive_id = d.id WHERE st.id = :id", id=a["student_id"])
        status = drive_status(d)
        if status != "open":
            raise HttpError(403, STATUS_MESSAGE[status])
        if d["require_seb"] and not re.search(r"\bSEB/", user_agent(request)):
            raise HttpError(403, "This test must be taken in Safe Exam Browser. Please ask the coordinator for help.")
        questions = await db.all(
            """SELECT q.id, q.section_id, q.passage_id, q.options
                 FROM questions q JOIN sections s ON s.id = q.section_id
                WHERE q.exam_id = :exam ORDER BY s.position, s.id, q.position, q.id""",
            exam=d["exam_id"],
        )
        if not questions:
            raise conflict("This test has no questions yet. Please contact the coordinator.")
        order, option_orders = build_paper(questions, shuffle_questions=d["shuffle_questions"], shuffle_options=d["shuffle_options"])
        started = await db.run(
            """UPDATE attempts SET status = 'in_progress', started_at = now(), ends_at = now() + make_interval(mins => :mins),
                      question_order = CAST(:qo AS jsonb), option_orders = CAST(:oo AS jsonb)
                WHERE id = :id AND status = 'registered'""",
            id=a["id"], mins=d["duration_min"], qo=json.dumps(order), oo=json.dumps(option_orders),
        )
        if started:
            await log_event(a["id"], "started", user_agent(request))
    fresh = await db.one("SELECT * FROM attempts WHERE id = :id", id=a["id"])
    return await attempt_state(fresh)


@router.post("/answers")
async def save_answers(body: dict = Depends(json_body), attempt: dict = Depends(current_attempt)) -> dict[str, Any]:
    a = require_in_progress(attempt)
    items = body.get("answers")
    if not isinstance(items, list) or not items or len(items) > 500:
        raise bad_request("No answers to save.")
    on_paper = set(a["question_order"] or [])
    ids = [_whole(x.get("questionId") if isinstance(x, dict) else None) for x in items]
    if not all(qid in on_paper for qid in ids):
        raise bad_request("Unknown question.")
    counts = {r["id"]: r["n"] for r in await db.all("SELECT id, jsonb_array_length(options) AS n FROM questions WHERE id = ANY(CAST(:ids AS int[]))", ids=ids)}
    clean: dict[int, dict[str, Any]] = {}  # the last answer per question wins
    for x, qid in zip(items, ids, strict=True):
        raw = x.get("selected")
        sel = None if raw is None else _whole(raw)
        if raw is not None and (sel is None or sel < 0 or sel >= counts.get(qid, 0)):
            raise bad_request("Invalid answer.")
        clean[qid] = {"qid": qid, "sel": sel, "rev": bool(x.get("review"))}
    async with db.transaction() as tx:
        # Re-checked under a lock: a submit or time-up on another worker may have finished since this request began,
        # and an answer written after marking would show up later (e.g. on re-grade) without having been marked.
        still_open = await tx.one(
            """SELECT 1 FROM attempts WHERE id = :id AND status = 'in_progress'
                  AND now() <= ends_at + make_interval(secs => :grace) FOR SHARE""",
            id=a["id"], grace=settings.grace_seconds,
        )
        if not still_open:
            raise conflict("Your test has already been submitted.", submitted=True)
        await tx.run(
            """INSERT INTO answers (attempt_id, question_id, selected, marked_review, updated_at)
               SELECT :id, x.qid, x.sel, x.rev, now() FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(qid int, sel int, rev boolean)
               ON CONFLICT (attempt_id, question_id)
               DO UPDATE SET selected = excluded.selected, marked_review = excluded.marked_review, updated_at = now()""",
            id=a["id"], rows=json.dumps(list(clean.values())),
        )
    return {"saved": len(clean)}


@router.post("/events")
async def record_event(body: dict = Depends(json_body), attempt: dict = Depends(current_attempt)) -> dict[str, Any]:
    a = require_in_progress(attempt)
    type_ = str(body.get("type") or "")
    if type_ not in VIOLATION_EVENTS and type_ not in INFO_EVENTS:
        raise bad_request("Unknown event.")
    await log_event(a["id"], type_, body.get("detail") or "")
    max_violations = await db.value("SELECT d.max_violations FROM drives d JOIN students st ON st.drive_id = d.id WHERE st.id = :id", id=a["student_id"])
    if type_ not in VIOLATION_EVENTS:
        return {"violations": a["violations"], "maxViolations": max_violations, "submitted": False}

    violations = await db.value("UPDATE attempts SET violations = violations + 1 WHERE id = :id RETURNING violations", id=a["id"])
    submitted = False
    if max_violations > 0 and violations >= max_violations:
        async with db.transaction() as tx:
            await finalize_attempt(tx, a["id"], "violations")
        submitted = True
    return {"violations": violations, "maxViolations": max_violations, "submitted": submitted}


@router.post("/snapshot", status_code=201)
async def snapshot(request: Request, attempt: dict = Depends(current_attempt)) -> dict[str, Any]:
    a = require_in_progress(attempt)
    is_jpeg_upload = request.headers.get("content-type", "").split(";")[0].strip() == "image/jpeg"
    image = await read_body(request, SNAPSHOT_LIMIT) if is_jpeg_upload else b""
    if len(image) < 100 or image[:2] != b"\xff\xd8":
        raise bad_request("Invalid image.")
    await db.run("INSERT INTO snapshots (attempt_id, image) VALUES (:id, :img)", id=a["id"], img=image)
    return {"ok": True}


@router.post("/submit")
async def submit(attempt: dict = Depends(current_attempt)) -> JSONResponse:
    a = attempt
    if a["status"] == "registered":
        raise conflict("The test has not been started yet.")
    # The page submits by itself when its timer runs out; the server decides which it was.
    reason = "time_up" if a["ends_at"] and datetime.now(UTC) >= a["ends_at"] else "student"
    async with db.transaction() as tx:
        await finalize_attempt(tx, a["id"], reason)
    return JSONResponse({"status": "submitted"})

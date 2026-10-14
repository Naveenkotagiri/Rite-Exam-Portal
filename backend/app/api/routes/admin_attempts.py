"""One candidate: detail page, camera photos and coordinator actions."""

from typing import Any

from fastapi import APIRouter, Depends, Response

from app import db
from app.api.deps import id_param, json_body, require_admin
from app.core.errors import bad_request, conflict, not_found
from app.core.forms import to_number
from app.services.candidates import load_attempt, log_admin_event
from app.services.grading import finalize_attempt

router = APIRouter(prefix="/api/admin", tags=["admin: candidates"], dependencies=[Depends(require_admin)])

HIDDEN = {"token_hash", "question_order", "option_orders"}


@router.get("/attempts/{attempt_id}")
async def candidate(attempt_id: str) -> dict[str, Any]:
    a = await load_attempt(id_param(attempt_id))
    order: list[int] = a["question_order"] or []
    questions = await db.all(
        """SELECT q.id, q.text, q.options, q.correct_index, q.marks, s.name AS section
             FROM questions q JOIN sections s ON s.id = q.section_id WHERE q.id = ANY(CAST(:ids AS int[]))""",
        ids=order,
    )
    answers = await db.all("SELECT question_id, selected, marked_review FROM answers WHERE attempt_id = :id", id=a["id"])
    events = await db.all("SELECT type, detail, created_at FROM attempt_events WHERE attempt_id = :id ORDER BY created_at, id", id=a["id"])
    photos = await db.all("SELECT id, created_at FROM snapshots WHERE attempt_id = :id ORDER BY created_at", id=a["id"])
    by_id = {q["id"]: q for q in questions}
    answered = {r["question_id"]: r for r in answers}
    paper = []
    for n, qid in enumerate(order, start=1):
        q = by_id.get(qid)
        if not q:
            continue
        r = answered.get(qid)
        paper.append({"n": n, "id": qid, "section": q["section"], "text": q["text"], "options": q["options"], "correctIndex": q["correct_index"],
                      "marks": q["marks"], "selected": r["selected"] if r else None, "review": r["marked_review"] if r else False})
    return {"attempt": {k: v for k, v in a.items() if k not in HIDDEN}, "questions": paper, "events": events, "snapshots": photos}


@router.get("/snapshots/{snapshot_id}")
async def photo(snapshot_id: str) -> Response:
    row = await db.one("SELECT image FROM snapshots WHERE id = :id", id=id_param(snapshot_id))
    if not row:
        raise not_found("Photo not found.")
    return Response(bytes(row["image"]), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.post("/attempts/{attempt_id}/extend", status_code=204)
async def extend(attempt_id: str, body: dict = Depends(json_body), admin: dict = Depends(require_admin)) -> Response:
    a = await load_attempt(id_param(attempt_id))
    minutes = to_number(body.get("minutes"))
    if not minutes.is_integer() or minutes < 1 or minutes > 180:
        raise bad_request("Minutes must be a whole number from 1 to 180.")
    if a["status"] != "in_progress":
        raise conflict("Time can only be added while the candidate is taking the test.")
    await db.run("UPDATE attempts SET ends_at = ends_at + make_interval(mins => :m) WHERE id = :id AND status = 'in_progress'", id=a["id"], m=int(minutes))
    await log_admin_event(a["id"], "time_extended", f"{int(minutes)} min by {admin['email']}")
    return Response(status_code=204)


@router.post("/attempts/{attempt_id}/allow-relogin", status_code=204)
async def allow_relogin(attempt_id: str, admin: dict = Depends(require_admin)) -> Response:
    """Lets the student continue a running test on another device: valid once, for 10 minutes."""
    a = await load_attempt(id_param(attempt_id))
    if a["status"] != "in_progress":
        raise conflict("Only a test in progress can be moved to another device.")
    await db.run("UPDATE attempts SET relogin_allowed_until = now() + interval '10 minutes' WHERE id = :id", id=a["id"])
    await log_admin_event(a["id"], "relogin_allowed", f"by {admin['email']}")
    return Response(status_code=204)


@router.post("/attempts/{attempt_id}/submit", status_code=204)
async def coordinator_submit(attempt_id: str) -> Response:
    a = await load_attempt(id_param(attempt_id))
    if a["status"] != "in_progress":
        raise conflict("Only a test in progress can be submitted.")
    async with db.transaction() as tx:
        await finalize_attempt(tx, a["id"], "coordinator")
    return Response(status_code=204)


@router.put("/attempts/{attempt_id}/result", status_code=204)
async def set_result(attempt_id: str, body: dict = Depends(json_body), admin: dict = Depends(require_admin)) -> Response:
    """HR moves one candidate in or out of the shortlist by hand."""
    a = await load_attempt(id_param(attempt_id))
    status = body.get("status")
    if status not in ("shortlisted", "not_selected"):
        raise bad_request("Status must be shortlisted or not_selected.")
    if a["status"] != "submitted":
        raise conflict("Only a submitted test can be shortlisted.")
    await db.run("UPDATE attempts SET result_status = :status, result_manual = true WHERE id = :id", id=a["id"], status=status)
    await log_admin_event(a["id"], "result_changed", f"{status} by {admin['email']}")
    return Response(status_code=204)


@router.delete("/attempts/{attempt_id}", status_code=204)
async def delete_candidate(attempt_id: str) -> Response:
    a = await load_attempt(id_param(attempt_id))
    await db.run("DELETE FROM students WHERE id = :id", id=a["student_id"])
    return Response(status_code=204)

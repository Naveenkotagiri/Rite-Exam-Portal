"""Campus drives: setup, live monitor data, results, publishing and re-grading."""

import re
import secrets
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Response

from app import db
from app.api.deps import MAX_ID, id_param, json_body, require_admin, xlsx_response
from app.core.errors import bad_request, conflict, not_found
from app.core.forms import Form
from app.services.candidates import drive_attempts, section_names
from app.services.drives import load_by_id, with_status
from app.services.excel import results_workbook
from app.services.grading import regrade_attempt

router = APIRouter(prefix="/api/admin/drives", tags=["admin: drives"], dependencies=[Depends(require_admin)])

DEFAULT_OTHER_MESSAGE = "Thank you for taking the test. You have not been shortlisted this time. We wish you the very best."

DRIVE_COUNTS = """
  (SELECT count(*) FROM students st WHERE st.drive_id = d.id) AS registered,
  (SELECT count(*) FROM students st JOIN attempts a ON a.student_id = st.id WHERE st.drive_id = d.id AND a.status = 'in_progress') AS in_progress,
  (SELECT count(*) FROM students st JOIN attempts a ON a.student_id = st.id WHERE st.drive_id = d.id AND a.status = 'submitted') AS submitted"""

DRIVE_COLUMNS = """code = :code, name = :name, college = :college, exam_id = :exam, drive_date = :date, opens_at = :opens, closes_at = :closes,
  is_open = :is_open, camera_required = :camera, snapshot_interval_sec = :interval, require_fullscreen = :fullscreen,
  max_violations = :max_violations, require_seb = :seb, shuffle_questions = :shuffle_q, shuffle_options = :shuffle_o"""


def _slug(s: str) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))[:24]


def _drive_input(body: dict[str, Any]) -> dict[str, Any]:
    f = Form(body)
    v = {
        "name": f.str("name", "Drive name", max=120),
        "college": f.str("college", "College", max=160),
        "exam": f.int("examId", "Exam", 1, MAX_ID),
        "code": str(body.get("code") or "").strip().lower(),
        "date": f.date("driveDate", "Drive date"),
        "opens": f.datetime("opensAt", "Opens at"),
        "closes": f.datetime("closesAt", "Closes at"),
        "is_open": f.bool("isOpen", True),
        "camera": f.bool("cameraRequired", True),
        "interval": f.int("snapshotIntervalSec", "Photo interval", 30, 600, 90),
        "fullscreen": f.bool("requireFullscreen", True),
        "max_violations": f.int("maxViolations", "Auto-submit after", 0, 50, 3),
        "seb": f.bool("requireSeb", False),
        "shuffle_q": f.bool("shuffleQuestions", True),
        "shuffle_o": f.bool("shuffleOptions", True),
    }
    if v["code"] and not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,39}", v["code"]):
        f.error("code", "Use 3–40 lowercase letters, digits or hyphens.")
    if v["opens"] and v["closes"] and v["closes"] <= v["opens"]:
        f.error("closesAt", "Closing time must be after opening time.")
    f.done()
    return v


async def _assert_exam(exam_id: int) -> None:
    if not await db.one("SELECT 1 FROM exams WHERE id = :id", id=exam_id):
        raise bad_request("Choose an exam.", fields={"examId": "Choose an exam."})


async def _code_taken(code: str, except_id: int = 0) -> bool:
    return bool(await db.one("SELECT 1 FROM drives WHERE code = :code AND id <> :id", code=code, id=except_id))


@router.get("")
async def list_drives() -> list[dict[str, Any]]:
    rows = await db.all(f"SELECT d.*, e.title AS exam_title, {DRIVE_COUNTS} FROM drives d JOIN exams e ON e.id = d.exam_id ORDER BY d.created_at DESC")
    return [with_status(d) for d in rows]


@router.post("", status_code=201)
async def create_drive(body: dict = Depends(json_body)) -> dict[str, Any]:
    v = _drive_input(body)
    await _assert_exam(v["exam"])
    if v["code"] and await _code_taken(v["code"]):
        raise conflict("This link code is already used by another drive.", fields={"code": "Already used."})
    while not v["code"] or await _code_taken(v["code"]):
        v["code"] = f"{_slug(v['college']) or 'drive'}-{secrets.token_hex(3)}"
    d = await db.one(
        """INSERT INTO drives (code, name, college, exam_id, drive_date, opens_at, closes_at, is_open, camera_required, snapshot_interval_sec,
                               require_fullscreen, max_violations, require_seb, shuffle_questions, shuffle_options)
           VALUES (:code, :name, :college, :exam, :date, :opens, :closes, :is_open, :camera, :interval,
                   :fullscreen, :max_violations, :seb, :shuffle_q, :shuffle_o) RETURNING *""",
        **v,
    )
    return with_status(d)


@router.get("/{drive_id}")
async def get_drive(drive_id: str) -> dict[str, Any]:
    return with_status(await load_by_id(id_param(drive_id)))


@router.put("/{drive_id}")
async def update_drive(drive_id: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    did = id_param(drive_id)
    current = await load_by_id(did)
    v = _drive_input(body)
    await _assert_exam(v["exam"])
    v["code"] = v["code"] or current["code"]
    if await _code_taken(v["code"], did):
        raise conflict("This link code is already used by another drive.", fields={"code": "Already used."})
    if v["exam"] != current["exam_id"] and await db.value("SELECT count(*) FROM students WHERE drive_id = :id", id=did):
        raise conflict("Students have already registered for this drive, so its exam cannot be changed.", fields={"examId": "Cannot change now."})
    d = await db.one(f"UPDATE drives SET {DRIVE_COLUMNS} WHERE id = :id RETURNING *", id=did, **v)
    return with_status(d)


@router.post("/{drive_id}/open")
async def open_or_close(drive_id: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    d = await db.one("UPDATE drives SET is_open = :open WHERE id = :id RETURNING *", id=id_param(drive_id), open=bool(body.get("isOpen")))
    if not d:
        raise not_found("Drive not found.")
    return with_status(d)


@router.delete("/{drive_id}", status_code=204)
async def delete_drive(drive_id: str) -> Response:
    await db.run("DELETE FROM drives WHERE id = :id", id=id_param(drive_id))
    return Response(status_code=204)


@router.get("/{drive_id}/attempts")
async def candidates(drive_id: str) -> dict[str, Any]:
    d = await load_by_id(id_param(drive_id))
    return {"serverNow": datetime.now(UTC), "sections": await section_names(d["exam_id"]), "attempts": await drive_attempts(d["id"])}


@router.get("/{drive_id}/results.xlsx")
async def export_results(drive_id: str) -> Response:
    d = await load_by_id(id_param(drive_id))
    data = results_workbook(d, await section_names(d["exam_id"]), await drive_attempts(d["id"]))
    return xlsx_response(f"{d['name']}-{d['college']}-results.xlsx", data)


@router.post("/{drive_id}/publish")
async def publish_results(drive_id: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    """Shortlists submitted tests at or above the cutoff; candidates changed by hand keep their result."""
    d = await load_by_id(id_param(drive_id))
    f = Form(body)
    cutoff = f.num("cutoffPct", "Cutoff", 0, 100, None)
    if cutoff is None and "cutoffPct" not in f.errors:
        f.error("cutoffPct", "Enter the cutoff percentage.")
    next_steps = f.str("nextSteps", "Message for shortlisted candidates", max=3000)
    other = f.str("otherMessage", "Message for other candidates", max=3000, required=False) or DEFAULT_OTHER_MESSAGE
    f.done()
    async with db.transaction() as tx:
        await tx.run(
            """UPDATE attempts a
                  SET result_status = CASE WHEN a.max_score > 0 AND a.score * 100.0 / a.max_score >= :cutoff THEN 'shortlisted' ELSE 'not_selected' END
                 FROM students st
                WHERE st.id = a.student_id AND st.drive_id = :drive AND a.status = 'submitted' AND NOT a.result_manual""",
            drive=d["id"], cutoff=cutoff,
        )
        await tx.run(
            """UPDATE drives SET results_published_at = now(), results_cutoff_pct = :cutoff, results_next_steps = :next, results_other_message = :other
                WHERE id = :drive""",
            drive=d["id"], cutoff=cutoff, next=next_steps, other=other,
        )
        return await tx.one(
            """SELECT count(*) FILTER (WHERE a.result_status = 'shortlisted') AS shortlisted,
                      count(*) FILTER (WHERE a.result_status = 'not_selected') AS not_selected,
                      count(*) FILTER (WHERE a.status <> 'submitted') AS not_submitted
                 FROM attempts a JOIN students st ON st.id = a.student_id WHERE st.drive_id = :drive""",
            drive=d["id"],
        )


@router.post("/{drive_id}/unpublish", status_code=204)
async def unpublish_results(drive_id: str) -> Response:
    if not await db.run("UPDATE drives SET results_published_at = NULL WHERE id = :id", id=id_param(drive_id)):
        raise not_found("Drive not found.")
    return Response(status_code=204)


@router.post("/{drive_id}/regrade")
async def regrade(drive_id: str) -> dict[str, Any]:
    d = await load_by_id(id_param(drive_id))
    rows = await db.all(
        "SELECT a.id FROM attempts a JOIN students st ON st.id = a.student_id WHERE st.drive_id = :drive AND a.status = 'submitted'", drive=d["id"]
    )
    for r in rows:
        async with db.transaction() as tx:
            await regrade_attempt(tx, r["id"])
    return {"regraded": len(rows)}

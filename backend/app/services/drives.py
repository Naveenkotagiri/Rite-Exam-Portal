"""Loading drives and describing them to students."""

from datetime import UTC, datetime
from typing import Any

from app import db
from app.core.errors import HttpError, not_found

DRIVE_SQL = """
  SELECT d.*, e.title AS exam_title, e.duration_min, e.instructions, e.negative_marks,
         (SELECT count(*) FROM questions WHERE exam_id = e.id) AS question_count,
         (SELECT coalesce(sum(marks), 0) FROM questions WHERE exam_id = e.id) AS total_marks
    FROM drives d JOIN exams e ON e.id = d.exam_id"""

STATUS_MESSAGE = {
    "not_started": "This test has not opened yet. Please wait for the coordinator to start it.",
    "closed": "This test is closed and is no longer accepting candidates.",
}


def drive_status(d: dict[str, Any], now: datetime | None = None) -> str:
    """open | not_started | closed"""
    now = now or datetime.now(UTC)
    if not d["is_open"]:
        return "closed"
    if d["opens_at"] and d["opens_at"] > now:
        return "not_started"
    if d["closes_at"] and d["closes_at"] < now:
        return "closed"
    return "open"


def with_status(d: dict[str, Any]) -> dict[str, Any]:
    return {**d, "status": drive_status(d)}


def public_drive(d: dict[str, Any]) -> dict[str, Any]:
    """What a student may see about a drive."""
    return {
        "code": d["code"],
        "name": d["name"],
        "college": d["college"],
        "driveDate": d["drive_date"],
        "examTitle": d["exam_title"],
        "durationMin": d["duration_min"],
        "instructions": d["instructions"],
        "questionCount": d["question_count"],
        "totalMarks": d["total_marks"],
        "negativeMarks": d["negative_marks"],
        "status": drive_status(d),
        "opensAt": d["opens_at"],
        "closesAt": d["closes_at"],
        "resultsPublished": bool(d["results_published_at"]),
        "proctoring": {
            "cameraRequired": d["camera_required"],
            "snapshotIntervalSec": d["snapshot_interval_sec"],
            "requireFullscreen": d["require_fullscreen"],
            "maxViolations": d["max_violations"],
            "requireSeb": d["require_seb"],
        },
    }


async def load_by_code(code: str) -> dict[str, Any]:
    d = await db.one(f"{DRIVE_SQL} WHERE d.code = :code", code=str(code).lower())
    if not d:
        raise HttpError(404, "This test link is not valid. Please check the link with your coordinator.")
    return d


async def load_by_id(drive_id: int) -> dict[str, Any]:
    d = await db.one(f"{DRIVE_SQL} WHERE d.id = :id", id=drive_id)
    if not d:
        raise not_found("Drive not found.")
    return d

"""Candidate lists and lookups for the admin monitor, results and candidate pages."""

from typing import Any

from app import db
from app.core.errors import not_found


async def drive_attempts(drive_id: int) -> list[dict[str, Any]]:
    """Every candidate of a drive: submitted ones first, ranked by score (equal scores share a rank)."""
    rows = await db.all(
        """SELECT a.id, a.status, a.violations, a.started_at, a.ends_at, a.submitted_at, a.last_seen_at, a.score, a.max_score,
                  a.section_scores, a.submit_reason, a.relogin_requested_at, a.result_status, a.result_manual,
                  coalesce(a.status = 'in_progress' AND a.relogin_allowed_until > now(), false) AS relogin_approved,
                  (a.status = 'in_progress' AND a.relogin_requested_at IS NOT NULL
                    AND (a.relogin_allowed_until IS NULL OR a.relogin_allowed_until <= now())) AS relogin_pending,
                  st.first_name, st.middle_name, st.last_name, st.student_code, st.email, st.phone,
                  st.created_at AS registered_at,
                  coalesce(jsonb_array_length(a.question_order), 0) AS total,
                  (SELECT count(*) FROM answers x WHERE x.attempt_id = a.id AND x.selected IS NOT NULL) AS answered,
                  (SELECT count(*) FROM snapshots sn WHERE sn.attempt_id = a.id) AS snapshot_count
             FROM attempts a JOIN students st ON st.id = a.student_id
            WHERE st.drive_id = :drive
            ORDER BY (a.status = 'submitted') DESC, a.score DESC NULLS LAST, a.submitted_at, st.created_at""",
        drive=drive_id,
    )
    rank, prev = 0, None
    for i, r in enumerate(rows):
        if r["status"] != "submitted":
            continue
        if r["score"] != prev:
            rank = i + 1
        prev = r["score"]
        r["rank"] = rank
    return rows


async def section_names(exam_id: int) -> list[str]:
    rows = await db.all("SELECT name FROM sections WHERE exam_id = :id ORDER BY position, id", id=exam_id)
    return [r["name"] for r in rows]


async def load_attempt(attempt_id: int) -> dict[str, Any]:
    a = await db.one(
        """SELECT a.*, st.first_name, st.middle_name, st.last_name, st.student_code, st.email, st.phone, st.user_agent,
                  st.created_at AS registered_at, st.drive_id, d.name AS drive_name, d.college, d.exam_id
             FROM attempts a JOIN students st ON st.id = a.student_id JOIN drives d ON d.id = st.drive_id
            WHERE a.id = :id""",
        id=attempt_id,
    )
    if not a:
        raise not_found("Candidate not found.")
    return a


async def log_admin_event(attempt_id: int, type_: str, detail: str) -> None:
    await db.run("INSERT INTO attempt_events (attempt_id, type, detail) VALUES (:id, :type, :detail)", id=attempt_id, type=type_, detail=detail)

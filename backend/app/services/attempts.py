"""A student's test attempt: what their test page shows, and the activity log."""

from datetime import UTC, datetime
from typing import Any

from app import db
from app.core.errors import conflict
from app.services.drives import DRIVE_SQL, public_drive


async def log_event(attempt_id: int, type_: str, detail: Any = "") -> None:
    await db.run(
        "INSERT INTO attempt_events (attempt_id, type, detail) VALUES (:id, :type, :detail)",
        id=attempt_id, type=type_, detail=str(detail or "")[:500],
    )


def require_in_progress(a: dict[str, Any]) -> dict[str, Any]:
    if a["status"] == "submitted":
        raise conflict("Your test has already been submitted.", submitted=True)
    if a["status"] != "in_progress":
        raise conflict("The test has not been started yet.")
    return a


async def attempt_state(a: dict[str, Any]) -> dict[str, Any]:
    """Everything the test page needs. Correct answers are never included."""
    st = await db.one("SELECT * FROM students WHERE id = :id", id=a["student_id"])
    d = await db.one(f"{DRIVE_SQL} WHERE d.id = :id", id=st["drive_id"])
    out: dict[str, Any] = {
        "student": {
            "firstName": st["first_name"], "middleName": st["middle_name"], "lastName": st["last_name"],
            "studentId": st["student_code"], "email": st["email"], "phone": st["phone"],
        },
        "drive": public_drive(d),
        "status": a["status"],
        "violations": a["violations"],
        "serverNow": datetime.now(UTC),
    }
    if a["status"] != "in_progress":
        return out

    out["startedAt"] = a["started_at"]
    out["endsAt"] = a["ends_at"]
    order: list[int] = a["question_order"] or []
    questions = await db.all(
        """SELECT q.id, q.text, q.options, q.marks, q.passage_id, s.name AS section, s.hint AS section_hint,
                  p.title AS passage_title, p.body AS passage_body
             FROM questions q JOIN sections s ON s.id = q.section_id LEFT JOIN passages p ON p.id = q.passage_id
            WHERE q.id = ANY(CAST(:ids AS int[]))""",
        ids=order,
    )
    by_id = {q["id"]: q for q in questions}
    option_orders: dict[str, list[int]] = a["option_orders"] or {}
    paper = []
    for qid in order:
        q = by_id.get(qid)
        if not q:
            continue
        keys = [k for k in option_orders.get(str(q["id"]), list(range(len(q["options"])))) if k < len(q["options"])]
        paper.append({
            "id": q["id"],
            "n": len(paper) + 1,
            "section": q["section"],
            "sectionHint": q["section_hint"],
            "passage": {"id": q["passage_id"], "title": q["passage_title"], "body": q["passage_body"]} if q["passage_id"] else None,
            "text": q["text"],
            "marks": q["marks"],
            "options": [{"key": k, "text": q["options"][k]} for k in keys],
        })
    out["questions"] = paper
    answers = await db.all("SELECT question_id, selected, marked_review FROM answers WHERE attempt_id = :id", id=a["id"])
    out["answers"] = {str(r["question_id"]): {"selected": r["selected"], "review": r["marked_review"]} for r in answers}
    return out

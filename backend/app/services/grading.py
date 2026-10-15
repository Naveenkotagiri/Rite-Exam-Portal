"""Marking. Scores are always computed here on the server from the answer key; browsers never send scores."""

import json
import math
from typing import Any

from app import db
from app.config import settings
from app.db import Db


def round2(n: float) -> float:
    """Rounds like JavaScript's Math.round(n * 100) / 100 (halves go up), as the Node.js version did."""
    return math.floor(n * 100 + 0.5) / 100


async def score_attempt(tx: Db, attempt_id: int) -> dict[str, Any]:
    """Scores an attempt against the current answer key, over the questions on that student's paper."""
    rows = await tx.all(
        """SELECT q.id, q.correct_index, q.marks, s.name AS section, e.negative_marks, ans.selected
             FROM attempts a
             JOIN students st ON st.id = a.student_id
             JOIN drives d ON d.id = st.drive_id
             JOIN exams e ON e.id = d.exam_id
             JOIN questions q ON q.exam_id = e.id
             JOIN sections s ON s.id = q.section_id
             LEFT JOIN answers ans ON ans.attempt_id = a.id AND ans.question_id = q.id
            WHERE a.id = :id
              AND q.id IN (SELECT jsonb_array_elements_text(a.question_order)::int)
            ORDER BY s.position, s.id, q.position, q.id""",
        id=attempt_id,
    )
    sections: list[dict[str, Any]] = []
    by_name: dict[str, dict[str, Any]] = {}
    for r in rows:
        sec = by_name.get(r["section"])
        if sec is None:
            sec = {"name": r["section"], "score": 0.0, "max": 0.0, "correct": 0, "wrong": 0, "attempted": 0}
            by_name[r["section"]] = sec
            sections.append(sec)
        sec["max"] += r["marks"]
        if r["selected"] is None:
            continue
        sec["attempted"] += 1
        if r["selected"] == r["correct_index"]:
            sec["score"] += r["marks"]
            sec["correct"] += 1
        else:
            sec["score"] -= r["negative_marks"]
            sec["wrong"] += 1
    for sec in sections:
        sec["score"] = round2(sec["score"])
        sec["max"] = round2(sec["max"])
    return {
        "score": round2(sum(s["score"] for s in sections)),
        "max": round2(sum(s["max"] for s in sections)),
        "sections": sections,
    }


async def finalize_attempt(tx: Db, attempt_id: int, reason: str, *, only_if_expired: bool = False) -> bool:
    """Submits and marks an in-progress attempt. Safe to call concurrently; returns False if nothing changed.

    only_if_expired: for the automatic time-up, re-check the deadline under the lock, so time a coordinator
    added a moment ago is honoured.
    """
    a = await tx.one(
        "SELECT id, status, now() > ends_at + make_interval(secs => :grace) AS expired FROM attempts WHERE id = :id FOR UPDATE",
        id=attempt_id, grace=settings.grace_seconds,
    )
    if not a or a["status"] != "in_progress" or (only_if_expired and not a["expired"]):
        return False
    g = await score_attempt(tx, attempt_id)
    await tx.run(
        """UPDATE attempts
              SET status = 'submitted',
                  submitted_at = CASE WHEN CAST(:reason AS text) = 'time_up' THEN LEAST(now(), ends_at) ELSE now() END,
                  submit_reason = :reason, score = :score, max_score = :max, section_scores = CAST(:sections AS jsonb)
            WHERE id = :id""",
        id=attempt_id, reason=reason, score=g["score"], max=g["max"], sections=json.dumps(g["sections"]),
    )
    # Results already published (HR published while this candidate was still writing): apply the published cutoff,
    # so their result page shows the real outcome instead of "not selected".
    await tx.run(
        """UPDATE attempts a
              SET result_status = CASE WHEN a.max_score > 0 AND a.score * 100.0 / a.max_score >= d.results_cutoff_pct
                                       THEN 'shortlisted' ELSE 'not_selected' END
             FROM students st JOIN drives d ON d.id = st.drive_id
            WHERE a.id = :id AND st.id = a.student_id AND d.results_published_at IS NOT NULL AND NOT a.result_manual""",
        id=attempt_id,
    )
    await tx.run("INSERT INTO attempt_events (attempt_id, type, detail) VALUES (:id, 'submitted', :reason)", id=attempt_id, reason=reason)
    return True


async def regrade_attempt(tx: Db, attempt_id: int) -> None:
    """Re-scores a submitted attempt, e.g. after the answer key was corrected."""
    g = await score_attempt(tx, attempt_id)
    await tx.run(
        "UPDATE attempts SET score = :score, max_score = :max, section_scores = CAST(:sections AS jsonb) WHERE id = :id AND status = 'submitted'",
        id=attempt_id, score=g["score"], max=g["max"], sections=json.dumps(g["sections"]),
    )


async def sweep_expired() -> int:
    """Submits every attempt whose timer ran out but whose browser never submitted (closed tab, lost power)."""
    rows = await db.all(
        "SELECT id FROM attempts WHERE status = 'in_progress' AND ends_at < now() - make_interval(secs => :grace)",
        grace=settings.grace_seconds,
    )
    for r in rows:
        async with db.transaction() as tx:
            await finalize_attempt(tx, r["id"], "time_up", only_if_expired=True)
    return len(rows)

"""Exam (question paper) lookups shared by the admin routes."""

from typing import Any

from app import db
from app.core.errors import not_found

LOCKED_MESSAGE = ("Students have already taken this exam, so questions cannot be added or removed. "
                  "You can still fix question text and answers, or duplicate the exam to make a new version.")


async def load_exam(exam_id: int) -> dict[str, Any]:
    exam = await db.one("SELECT * FROM exams WHERE id = :id", id=exam_id)
    if not exam:
        raise not_found("Exam not found.")
    return exam


async def exam_is_locked(exam_id: int) -> bool:
    """True once any student has started a test on this exam: the paper can no longer gain or lose questions."""
    return await db.value(
        """SELECT EXISTS (SELECT 1 FROM attempts a JOIN students st ON st.id = a.student_id JOIN drives d ON d.id = st.drive_id
                           WHERE d.exam_id = :id AND a.status <> 'registered')""",
        id=exam_id,
    )


async def questions_with_context(exam_id: int) -> list[dict[str, Any]]:
    """An exam's questions in paper order, with their section and passage, for Excel export."""
    return await db.all(
        """SELECT q.*, s.name AS section, s.hint AS section_hint, p.title AS passage_title, p.body AS passage_body
             FROM questions q JOIN sections s ON s.id = q.section_id LEFT JOIN passages p ON p.id = q.passage_id
            WHERE q.exam_id = :id ORDER BY s.position, s.id, q.position, q.id""",
        id=exam_id,
    )

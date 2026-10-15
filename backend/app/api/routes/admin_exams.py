"""Question papers: exams, sections, reading passages, questions, and Excel import/export."""

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, Request, Response

from app import db
from app.api.deps import MAX_ID, id_param, json_body, read_body, require_admin, xlsx_response
from app.core.errors import bad_request, conflict, not_found
from app.core.forms import Form
from app.services.exams import LOCKED_MESSAGE, exam_is_locked, load_exam, questions_with_context
from app.services.excel import SAMPLE_ROWS, exam_to_rows, parse_questions_workbook, questions_workbook

router = APIRouter(prefix="/api/admin", tags=["admin: exams"], dependencies=[Depends(require_admin)])

IMPORT_LIMIT = 10 * 1024 * 1024


# ---- Exams ----

def _exam_input(body: dict[str, Any]) -> dict[str, Any]:
    f = Form(body)
    v = {
        "title": f.str("title", "Title", max=200),
        "duration": f.int("durationMin", "Duration", 1, 600),
        "instructions": f.str("instructions", "Instructions", max=5000, required=False),
        "negative": f.num("negativeMarks", "Negative marks", 0, 10, 0),
    }
    f.done()
    return v


@router.get("/exams")
async def list_exams() -> list[dict[str, Any]]:
    return await db.all(
        """SELECT e.*,
                  (SELECT count(*) FROM questions WHERE exam_id = e.id) AS question_count,
                  (SELECT coalesce(sum(marks), 0) FROM questions WHERE exam_id = e.id) AS total_marks,
                  (SELECT count(*) FROM drives WHERE exam_id = e.id) AS drive_count
             FROM exams e ORDER BY e.created_at DESC"""
    )


@router.post("/exams", status_code=201)
async def create_exam(body: dict = Depends(json_body)) -> dict[str, Any]:
    v = _exam_input(body)
    return await db.one(
        "INSERT INTO exams (title, duration_min, instructions, negative_marks) VALUES (:title, :duration, :instructions, :negative) RETURNING *", **v
    )


@router.get("/exams/{exam_id}")
async def get_exam(exam_id: str) -> dict[str, Any]:
    exam = await load_exam(id_param(exam_id))
    sections = await db.all("SELECT * FROM sections WHERE exam_id = :id ORDER BY position, id", id=exam["id"])
    passages = await db.all("SELECT * FROM passages WHERE exam_id = :id ORDER BY id", id=exam["id"])
    questions = await db.all(
        "SELECT q.* FROM questions q JOIN sections s ON s.id = q.section_id WHERE q.exam_id = :id ORDER BY s.position, s.id, q.position, q.id",
        id=exam["id"],
    )
    return {**exam, "locked": await exam_is_locked(exam["id"]), "sections": sections, "passages": passages, "questions": questions}


@router.put("/exams/{exam_id}")
async def update_exam(exam_id: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    eid = id_param(exam_id)
    v = _exam_input(body)
    exam = await db.one(
        """UPDATE exams SET title = :title, duration_min = :duration, instructions = :instructions, negative_marks = :negative, updated_at = now()
            WHERE id = :id RETURNING *""",
        id=eid, **v,
    )
    if not exam:
        raise not_found("Exam not found.")
    return exam


@router.delete("/exams/{exam_id}", status_code=204)
async def delete_exam(exam_id: str) -> Response:
    eid = id_param(exam_id)
    if await db.value("SELECT count(*) FROM drives WHERE exam_id = :id", id=eid):
        raise conflict("This exam is used by a drive. Delete or change those drives first.")
    await db.run("DELETE FROM exams WHERE id = :id", id=eid)
    return Response(status_code=204)


@router.post("/exams/{exam_id}/duplicate", status_code=201)
async def duplicate_exam(exam_id: str) -> dict[str, Any]:
    src = await load_exam(id_param(exam_id))
    async with db.transaction() as tx:
        copy = await tx.one(
            "INSERT INTO exams (title, duration_min, instructions, negative_marks) VALUES (:title, :d, :i, :n) RETURNING *",
            title=f"{src['title']} (copy)"[:200], d=src["duration_min"], i=src["instructions"], n=src["negative_marks"],
        )
        section_map: dict[str, int] = {}
        for s in await tx.all("SELECT * FROM sections WHERE exam_id = :id ORDER BY position, id", id=src["id"]):
            section_map[str(s["id"])] = await tx.value(
                "INSERT INTO sections (exam_id, name, hint, position) VALUES (:e, :name, :hint, :pos) RETURNING id",
                e=copy["id"], name=s["name"], hint=s["hint"], pos=s["position"],
            )
        passage_map: dict[str, int] = {}
        for p in await tx.all("SELECT * FROM passages WHERE exam_id = :id", id=src["id"]):
            passage_map[str(p["id"])] = await tx.value(
                "INSERT INTO passages (exam_id, title, body) VALUES (:e, :title, :body) RETURNING id", e=copy["id"], title=p["title"], body=p["body"]
            )
        await tx.run(
            """INSERT INTO questions (exam_id, section_id, passage_id, position, text, options, correct_index, marks)
               SELECT :e, (CAST(:smap AS jsonb) ->> q.section_id::text)::int, (CAST(:pmap AS jsonb) ->> q.passage_id::text)::int,
                      q.position, q.text, q.options, q.correct_index, q.marks
                 FROM questions q WHERE q.exam_id = :src""",
            e=copy["id"], smap=json.dumps(section_map), pmap=json.dumps(passage_map), src=src["id"],
        )
    return copy


# ---- Sections ----

def _section_input(body: dict[str, Any]) -> tuple[str, str]:
    f = Form(body)
    name = f.str("name", "Section name", max=100)
    hint = f.str("hint", "Hint", max=300, required=False)
    f.done()
    return name, hint


@router.post("/exams/{exam_id}/sections", status_code=201)
async def add_section(exam_id: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    exam = await load_exam(id_param(exam_id))
    if await exam_is_locked(exam["id"]):
        raise conflict(LOCKED_MESSAGE)
    name, hint = _section_input(body)
    return await db.one(
        """INSERT INTO sections (exam_id, name, hint, position)
           VALUES (:e, :name, :hint, (SELECT coalesce(max(position), 0) + 1 FROM sections WHERE exam_id = :e)) RETURNING *""",
        e=exam["id"], name=name, hint=hint,
    )


@router.put("/sections/{section_id}")
async def update_section(section_id: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    sid = id_param(section_id)
    name, hint = _section_input(body)
    section = await db.one("UPDATE sections SET name = :name, hint = :hint WHERE id = :id RETURNING *", id=sid, name=name, hint=hint)
    if not section:
        raise not_found("Section not found.")
    return section


@router.post("/sections/{section_id}/move", status_code=204)
async def move_section(section_id: str, body: dict = Depends(json_body)) -> Response:
    sid = id_param(section_id)
    step = -1 if body.get("direction") == "up" else 1
    async with db.transaction() as tx:
        section = await tx.one("SELECT * FROM sections WHERE id = :id", id=sid)
        if not section:
            raise not_found("Section not found.")
        ids = [r["id"] for r in await tx.all("SELECT id FROM sections WHERE exam_id = :e ORDER BY position, id", e=section["exam_id"])]
        i = ids.index(sid)
        j = i + step
        if 0 <= j < len(ids):
            ids[i], ids[j] = ids[j], ids[i]
            await tx.run(
                "UPDATE sections SET position = x.pos FROM unnest(CAST(:ids AS int[])) WITH ORDINALITY AS x(id, pos) WHERE sections.id = x.id", ids=ids
            )
    return Response(status_code=204)


@router.delete("/sections/{section_id}", status_code=204)
async def delete_section(section_id: str) -> Response:
    section = await db.one("SELECT * FROM sections WHERE id = :id", id=id_param(section_id))
    if not section:
        raise not_found("Section not found.")
    if await exam_is_locked(section["exam_id"]):
        raise conflict(LOCKED_MESSAGE)
    await db.run("DELETE FROM sections WHERE id = :id", id=section["id"])
    return Response(status_code=204)


# ---- Passages ----

def _passage_input(body: dict[str, Any]) -> dict[str, str]:
    f = Form(body)
    v = {"title": f.str("title", "Passage title", max=120), "body": f.str("body", "Passage text", max=20000)}
    f.done()
    return v


@router.post("/exams/{exam_id}/passages", status_code=201)
async def add_passage(exam_id: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    exam = await load_exam(id_param(exam_id))
    return await db.one("INSERT INTO passages (exam_id, title, body) VALUES (:e, :title, :body) RETURNING *", e=exam["id"], **_passage_input(body))


@router.put("/passages/{passage_id}")
async def update_passage(passage_id: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    v = _passage_input(body)
    passage = await db.one("UPDATE passages SET title = :title, body = :body WHERE id = :id RETURNING *", id=id_param(passage_id), **v)
    if not passage:
        raise not_found("Passage not found.")
    return passage


@router.delete("/passages/{passage_id}", status_code=204)
async def delete_passage(passage_id: str) -> Response:
    await db.run("DELETE FROM passages WHERE id = :id", id=id_param(passage_id))
    return Response(status_code=204)


# ---- Questions ----

async def _question_input(body: dict[str, Any], exam_id: int) -> dict[str, Any]:
    f = Form(body)
    text = f.str("text", "Question", max=4000)
    section_id = f.int("sectionId", "Section", 1, MAX_ID)
    passage_id = f.int("passageId", "Passage", 1, MAX_ID) if body.get("passageId") else None
    raw = body.get("options")
    options = [("" if o is None else str(o)).strip() for o in raw] if isinstance(raw, list) else []
    while options and not options[-1]:
        options.pop()
    if len(options) < 2 or len(options) > 5:
        f.error("options", "Give between 2 and 5 options.")
    elif any(not o for o in options):
        f.error("options", "Options cannot be empty.")
    elif any(len(o) > 1000 for o in options):
        f.error("options", "An option is too long.")
    correct = f.int("correctIndex", "Correct answer", 0, 4)
    if correct is not None and correct >= len(options):
        f.error("correctIndex", "Choose which option is correct.")
    marks = f.num("marks", "Marks", 0.25, 100, 1)
    f.done()
    if not await db.one("SELECT 1 FROM sections WHERE id = :id AND exam_id = :e", id=section_id, e=exam_id):
        raise bad_request("Choose a section of this exam.", fields={"sectionId": "Choose a section."})
    if passage_id and not await db.one("SELECT 1 FROM passages WHERE id = :id AND exam_id = :e", id=passage_id, e=exam_id):
        raise bad_request("Choose a passage of this exam.", fields={"passageId": "Choose a passage."})
    return {"text": text, "section": section_id, "passage": passage_id, "options": json.dumps(options), "correct": correct, "marks": marks,
            "_count": len(options)}


@router.post("/exams/{exam_id}/questions", status_code=201)
async def add_question(exam_id: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    exam = await load_exam(id_param(exam_id))
    if await exam_is_locked(exam["id"]):
        raise conflict(LOCKED_MESSAGE)
    v = await _question_input(body, exam["id"])
    v.pop("_count")
    return await db.one(
        """INSERT INTO questions (exam_id, section_id, passage_id, position, text, options, correct_index, marks)
           VALUES (:e, :section, :passage, (SELECT coalesce(max(position), 0) + 1 FROM questions WHERE exam_id = :e),
                   :text, CAST(:options AS jsonb), :correct, :marks) RETURNING *""",
        e=exam["id"], **v,
    )


@router.put("/questions/{question_id}")
async def update_question(question_id: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    qid = id_param(question_id)
    current = await db.one("SELECT * FROM questions WHERE id = :id", id=qid)
    if not current:
        raise not_found("Question not found.")
    v = await _question_input(body, current["exam_id"])
    if v.pop("_count") != len(current["options"]) and await exam_is_locked(current["exam_id"]):
        raise conflict("Students have already answered this question, so the number of options cannot change. "
                       "You can still edit the wording and the correct answer.")
    return await db.one(
        """UPDATE questions SET section_id = :section, passage_id = :passage, text = :text, options = CAST(:options AS jsonb),
                                correct_index = :correct, marks = :marks
            WHERE id = :id RETURNING *""",
        id=qid, **v,
    )


@router.delete("/questions/{question_id}", status_code=204)
async def delete_question(question_id: str) -> Response:
    qid = id_param(question_id)
    current = await db.one("SELECT exam_id FROM questions WHERE id = :id", id=qid)
    if not current:
        raise not_found("Question not found.")
    if await exam_is_locked(current["exam_id"]):
        raise conflict(LOCKED_MESSAGE)
    await db.run("DELETE FROM questions WHERE id = :id", id=qid)
    return Response(status_code=204)


# ---- Excel ----

@router.get("/question-template.xlsx")
async def question_template() -> Response:
    return xlsx_response("question-template.xlsx", questions_workbook(SAMPLE_ROWS))


@router.get("/exams/{exam_id}/questions.xlsx")
async def export_questions(exam_id: str) -> Response:
    exam = await load_exam(id_param(exam_id))
    return xlsx_response(f"{exam['title']}-questions.xlsx", questions_workbook(exam_to_rows(await questions_with_context(exam["id"]))))


@router.post("/exams/{exam_id}/import")
async def import_questions(exam_id: str, request: Request, mode: str = "append") -> dict[str, Any]:
    exam = await load_exam(id_param(exam_id))
    mode = "replace" if mode == "replace" else "append"
    data = await read_body(request, IMPORT_LIMIT)
    if not data:
        raise bad_request("Choose an Excel file to upload.")
    if await exam_is_locked(exam["id"]):
        raise conflict(LOCKED_MESSAGE)

    # Parsing a large workbook takes a while; do it off the event loop so students on this worker are not held up.
    rows, errors = await asyncio.to_thread(parse_questions_workbook, data)
    if errors:
        raise bad_request(f"The file has {len(errors)} problem(s). Nothing was imported.", rowErrors=errors[:200])

    async with db.transaction() as tx:
        if mode == "replace":
            for table in ("questions", "passages", "sections"):
                await tx.run(f"DELETE FROM {table} WHERE exam_id = :e", e=exam["id"])
        sections = {r["name"].lower(): r["id"] for r in await tx.all("SELECT id, name FROM sections WHERE exam_id = :e", e=exam["id"])}
        passages = {r["title"].lower(): r["id"] for r in await tx.all("SELECT id, title FROM passages WHERE exam_id = :e", e=exam["id"])}
        pos = await tx.value("SELECT coalesce(max(position), 0) FROM questions WHERE exam_id = :e", e=exam["id"])
        spos = await tx.value("SELECT coalesce(max(position), 0) FROM sections WHERE exam_id = :e", e=exam["id"])
        counts = {"questions": 0, "sections": 0, "passages": 0}
        row_errors = []

        for r in rows:
            s_key = r["section"].lower()
            if s_key not in sections:
                spos += 1
                sections[s_key] = await tx.value(
                    "INSERT INTO sections (exam_id, name, hint, position) VALUES (:e, :name, :hint, :pos) RETURNING id",
                    e=exam["id"], name=r["section"], hint=r["sectionHint"], pos=spos,
                )
                counts["sections"] += 1
            elif r["sectionHint"]:
                await tx.run("UPDATE sections SET hint = :hint WHERE id = :id", id=sections[s_key], hint=r["sectionHint"])

            passage_id = None
            if r["passageTitle"]:
                p_key = r["passageTitle"].lower()
                if r["passageText"]:
                    if p_key in passages:
                        await tx.run("UPDATE passages SET body = :body WHERE id = :id", id=passages[p_key], body=r["passageText"])
                    else:
                        passages[p_key] = await tx.value(
                            "INSERT INTO passages (exam_id, title, body) VALUES (:e, :title, :body) RETURNING id",
                            e=exam["id"], title=r["passageTitle"], body=r["passageText"],
                        )
                        counts["passages"] += 1
                elif p_key not in passages:
                    row_errors.append({"row": r["row"], "message": f'Passage "{r["passageTitle"]}" has no Passage Text. Put the passage text on its first question.'})
                    continue
                passage_id = passages[p_key]

            pos += 1
            await tx.run(
                """INSERT INTO questions (exam_id, section_id, passage_id, position, text, options, correct_index, marks)
                   VALUES (:e, :s, :p, :pos, :text, CAST(:options AS jsonb), :correct, :marks)""",
                e=exam["id"], s=sections[s_key], p=passage_id, pos=pos, text=r["text"], options=json.dumps(r["options"]),
                correct=r["correctIndex"], marks=r["marks"],
            )
            counts["questions"] += 1
        if row_errors:
            # raising inside the transaction rolls back everything this upload wrote
            raise bad_request(f"The file has {len(row_errors)} problem(s). Nothing was imported.", rowErrors=row_errors)
    return {"mode": mode, **counts}

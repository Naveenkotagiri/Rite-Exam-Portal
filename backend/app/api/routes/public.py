"""Student-facing drive pages: drive info, registration and published results."""

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app import db
from app.api.deps import json_body, user_agent
from app.core.errors import HttpError, bad_request, conflict
from app.core.rate_limit import register_limit, result_limit
from app.core.security import hash_token, new_token
from app.core.validation import normalize_phone, normalize_student, normalize_student_id, valid_phone, validate_student
from app.services.attempts import log_event
from app.services.drives import STATUS_MESSAGE, drive_status, load_by_code, public_drive

router = APIRouter(prefix="/api", tags=["students"])


@router.get("/drives/{code}")
async def drive_info(code: str) -> dict[str, Any]:
    return public_drive(await load_by_code(code))


@router.post("/drives/{code}/result", dependencies=[Depends(result_limit)])
async def check_result(code: str, body: dict = Depends(json_body)) -> dict[str, Any]:
    """A student checks their published result with Student ID + phone. No marks are returned."""
    d = await load_by_code(code)
    if not d["results_published_at"]:
        raise HttpError(404, "Results for this drive have not been published yet. Please check again later.", published=False)
    student_id, phone = normalize_student_id(body.get("studentId")), normalize_phone(body.get("phone"))
    if not student_id or not valid_phone(phone):
        raise bad_request("Enter your Student ID and the 10-digit phone number you registered with.")
    r = await db.one(
        """SELECT st.first_name, a.status, a.result_status
             FROM students st JOIN attempts a ON a.student_id = st.id
            WHERE st.drive_id = :drive AND lower(st.student_code) = lower(:sid) AND st.phone = :phone""",
        drive=d["id"], sid=student_id, phone=phone,
    )
    if not r:
        raise HttpError(404, "No registration matches this Student ID and phone number. Use the details you registered with.")
    status = "not_submitted" if r["status"] != "submitted" else (r["result_status"] or "not_selected")
    message = d["results_next_steps"] if status == "shortlisted" else d["results_other_message"] if status == "not_selected" else ""
    return {"firstName": r["first_name"], "status": status, "message": message, "publishedAt": d["results_published_at"]}


@router.post("/drives/{code}/register", dependencies=[Depends(register_limit)])
async def register(code: str, request: Request, body: dict = Depends(json_body)) -> JSONResponse:
    d = await load_by_code(code)
    s = normalize_student(body)
    fields = validate_student(s)
    if fields:
        raise bad_request("Please correct the highlighted fields.", fields=fields)

    existing = await db.all(
        """SELECT st.student_code, st.email, st.phone, a.id AS attempt_id, a.status
             FROM students st JOIN attempts a ON a.student_id = st.id
            WHERE st.drive_id = :drive AND (lower(st.student_code) = lower(:sid) OR lower(st.email) = :email OR st.phone = :phone)""",
        drive=d["id"], sid=s["studentId"], email=s["email"], phone=s["phone"],
    )
    token = new_token()
    agent = user_agent(request)

    if existing:
        r = existing[0]
        same = len(existing) == 1 and r["student_code"].lower() == s["studentId"].lower() and r["email"] == s["email"] and r["phone"] == s["phone"]
        if not same:
            taken: dict[str, str] = {}
            for x in existing:
                if x["student_code"].lower() == s["studentId"].lower():
                    taken["studentId"] = "This Student ID is already registered for this test."
                if x["email"] == s["email"]:
                    taken["email"] = "This email is already registered for this test."
                if x["phone"] == s["phone"]:
                    taken["phone"] = "This phone number is already registered for this test."
            raise conflict(
                "These details are already registered. To continue your test, enter exactly the same Student ID, email and phone number you registered with.",
                fields=taken,
            )
        if r["status"] == "submitted":
            raise conflict("You have already submitted this test.")
        # Same student on a new device or browser. A fresh token logs out the old device. Once the test has
        # started, this needs a coordinator's one-time approval, so nobody can quietly take over someone's test.
        if r["status"] == "in_progress":
            changed = await db.run(
                """UPDATE attempts SET token_hash = :h, relogin_allowed_until = NULL, relogin_requested_at = NULL
                    WHERE id = :id AND relogin_allowed_until > now()""",
                h=hash_token(token), id=r["attempt_id"],
            )
            if not changed:
                await db.run("UPDATE attempts SET relogin_requested_at = now() WHERE id = :id", id=r["attempt_id"])
                await log_event(r["attempt_id"], "relogin_blocked", agent)
                raise conflict(
                    "Your test has already started on another device. To continue on this device, ask the coordinator to approve it, "
                    "then press Register & Continue again.",
                    reloginPending=True,
                )
        else:
            await db.run("UPDATE attempts SET token_hash = :h WHERE id = :id", h=hash_token(token), id=r["attempt_id"])
        await log_event(r["attempt_id"], "resumed", agent)
        return JSONResponse({"token": token, "resumed": True})

    status = drive_status(d)
    if status != "open":
        raise HttpError(403, STATUS_MESSAGE[status])

    async with db.transaction() as tx:
        student_id = await tx.value(
            """INSERT INTO students (drive_id, first_name, middle_name, last_name, student_code, email, phone, user_agent)
               VALUES (:drive, :first, :middle, :last, :sid, :email, :phone, :agent) RETURNING id""",
            drive=d["id"], first=s["firstName"], middle=s["middleName"], last=s["lastName"], sid=s["studentId"],
            email=s["email"], phone=s["phone"], agent=agent[:500],
        )
        await tx.run("INSERT INTO attempts (student_id, token_hash) VALUES (:sid, :h)", sid=student_id, h=hash_token(token))
    return JSONResponse({"token": token, "resumed": False}, status_code=201)

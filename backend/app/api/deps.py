"""Shared request helpers: reading bodies, ids, and the admin / student sessions."""

import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Request, Response

from app import db
from app.config import settings
from app.core.errors import HttpError, bad_request, not_found
from app.core.security import hash_token, read_admin_token
from app.services.excel import XLSX_TYPE
from app.services.grading import finalize_attempt

JSON_LIMIT = 1024 * 1024
MAX_ID = 2**31 - 1


def xlsx_response(filename: str, data: bytes) -> Response:
    safe = re.sub(r"[^\w.-]+", "_", filename, flags=re.ASCII)
    return Response(data, media_type=XLSX_TYPE, headers={"Content-Disposition": f'attachment; filename="{safe}"'})


def _too_large() -> HttpError:
    return HttpError(413, "The upload is too large.")


async def read_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise _too_large()
    data = await request.body()
    if len(data) > limit:
        raise _too_large()
    return data


async def json_body(request: Request) -> dict[str, Any]:
    """The JSON request body as a dict ({} when empty or not an object)."""
    raw = await read_body(request, JSON_LIMIT)
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError as err:
        raise bad_request("Invalid request.") from err
    return data if isinstance(data, dict) else {}


def id_param(value: str) -> int:
    """A positive whole-number id from the URL, or 404."""
    if not value.isdigit() or int(value) < 1 or int(value) > MAX_ID:
        raise not_found()
    return int(value)


def bearer(request: Request) -> str:
    header = request.headers.get("authorization", "")
    return header[7:].strip() if header.startswith("Bearer ") else ""


def user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")


async def require_admin(request: Request) -> dict[str, Any]:
    admin = read_admin_token(bearer(request))
    if not admin:
        raise HttpError(401, "Please log in again.")
    return admin


async def current_attempt(request: Request) -> dict[str, Any]:
    """The student's attempt from their session token. A test whose time ran out is submitted here."""
    token = bearer(request)
    attempt = await db.one("UPDATE attempts SET last_seen_at = now() WHERE token_hash = :h RETURNING *", h=hash_token(token)) if token else None
    if not attempt:
        raise HttpError(401, "Your session has ended. If you opened the test on another device, continue there, or register again with the same details.")
    if attempt["status"] == "in_progress" and datetime.now(UTC) > attempt["ends_at"] + timedelta(seconds=settings.grace_seconds):
        async with db.transaction() as tx:
            await finalize_attempt(tx, attempt["id"], "time_up")
        attempt["status"] = "submitted"
    return attempt

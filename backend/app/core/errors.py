"""Errors the API returns. Every error response is JSON: {"error": "<message>", ...extra}."""

import logging
from typing import Any

from asyncpg.exceptions import UniqueViolationError
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("app")


class HttpError(Exception):
    def __init__(self, status: int, message: str, **extra: Any):
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra


def bad_request(message: str, **extra: Any) -> HttpError:
    return HttpError(400, message, **extra)


def not_found(message: str = "Not found.") -> HttpError:
    return HttpError(404, message)


def conflict(message: str, **extra: Any) -> HttpError:
    return HttpError(409, message, **extra)


def _is_unique_violation(err: IntegrityError) -> bool:
    causes = (err.orig, getattr(err.orig, "__cause__", None))
    return any("23505" in (getattr(c, "sqlstate", None), getattr(c, "pgcode", None)) for c in causes)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HttpError)
    async def http_error(_: Request, err: HttpError) -> JSONResponse:
        return JSONResponse({"error": err.message, **err.extra}, status_code=err.status)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, __: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": "Invalid request."}, status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def starlette_error(_: Request, err: StarletteHTTPException) -> JSONResponse:
        message = "Not found." if err.status_code in (404, 405) else str(err.detail)
        return JSONResponse({"error": message}, status_code=404 if err.status_code == 405 else err.status_code)

    @app.exception_handler(IntegrityError)
    async def integrity_error(_: Request, err: IntegrityError) -> JSONResponse:
        if _is_unique_violation(err):
            return JSONResponse({"error": "That record already exists."}, status_code=409)
        log.exception("Database integrity error")
        return JSONResponse({"error": "Something went wrong. Please try again."}, status_code=500)

    @app.exception_handler(UniqueViolationError)
    async def unique_violation(_: Request, __: UniqueViolationError) -> JSONResponse:
        # Two requests creating the same record at the same moment (e.g. a double click, or a duplicate name).
        return JSONResponse({"error": "That record already exists."}, status_code=409)

    @app.exception_handler(Exception)
    async def unexpected(_: Request, err: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=err)
        return JSONResponse({"error": "Something went wrong. Please try again."}, status_code=500)

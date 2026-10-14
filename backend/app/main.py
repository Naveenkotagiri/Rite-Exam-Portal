"""The application: API routes, the built React website, and start-up tasks."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response

from app import db
from app.api.routes import admin_attempts, admin_auth, admin_drives, admin_exams, attempt, public
from app.config import DIST_DIR, settings
from app.core.errors import install_error_handlers
from app.core.headers import SecurityHeaders
from app.core.security import hash_password
from app.migrate import run_migrations
from app.services.grading import sweep_expired

log = logging.getLogger("app")
SWEEP_EVERY_SECONDS = 20


async def ensure_first_admin() -> None:
    if await db.value("SELECT count(*) FROM admins"):
        return
    email, password = settings.admin_email.strip().lower(), settings.admin_password
    if not email or len(password) < 8:
        log.warning("No admin accounts exist. Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters), or run: npm run create-admin")
        return
    await db.run("INSERT INTO admins (name, email, password_hash) VALUES (:n, :e, :h)", n=settings.admin_name, e=email, h=hash_password(password))
    log.warning("Created first admin account: %s", email)


async def sweeper() -> None:
    """Submits tests whose time ran out while the browser was closed."""
    while True:
        await asyncio.sleep(SWEEP_EVERY_SECONDS)
        try:
            await sweep_expired()
        except Exception as err:  # noqa: BLE001 - keep sweeping; the next round retries
            log.error("Sweep failed: %s", err)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await asyncio.to_thread(run_migrations)
    await ensure_first_admin()
    task = asyncio.create_task(sweeper())
    log.warning("Rite Exam Portal ready on port %s", settings.port)
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    await db.close()


def _website(app: FastAPI) -> None:
    """Serves the built React app (dist/) with a single-page-app fallback."""

    @app.get("/{path:path}", include_in_schema=False)
    async def website(path: str) -> Response:
        if path == "api" or path.startswith("api/"):
            return JSONResponse({"error": "Not found."}, status_code=404)
        if not DIST_DIR.exists():
            return JSONResponse({"error": "The website has not been built. Run: npm run build"}, status_code=404)
        file = (DIST_DIR / path).resolve()
        if path and file.is_file() and DIST_DIR.resolve() in file.parents:
            # Vite fingerprints files under assets/, so they can be cached for a year.
            cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "public, max-age=3600"
            return FileResponse(file, headers={"Cache-Control": cache})
        return FileResponse(DIST_DIR / "index.html", headers={"Cache-Control": "no-cache"})


def create_app(*, run_lifespan: bool = True) -> FastAPI:
    app = FastAPI(
        title="Rite Exam Portal API",
        version="2.0.0",
        lifespan=lifespan if run_lifespan else None,
        docs_url=None if settings.is_prod else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_prod else "/api/openapi.json",
    )
    app.add_middleware(SecurityHeaders)
    install_error_handlers(app)

    @app.get("/api/health", tags=["system"])
    async def health() -> dict[str, bool]:
        await db.value("SELECT 1")
        return {"ok": True}

    for module in (admin_auth, admin_exams, admin_drives, admin_attempts):
        app.include_router(module.router)
    app.include_router(admin_auth.public)
    app.include_router(public.router)
    app.include_router(attempt.router)
    _website(app)
    return app


app = create_app()

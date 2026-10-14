"""Brings the database schema up to date on start-up.

A database made by the Node.js version (it has a `schema_migrations` table and no `alembic_version`)
already holds the full schema, so it is stamped at the baseline revision instead of being recreated.
"""

import asyncio

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.config import BACKEND_DIR, settings

LEGACY_COMPLETE = "003_published_results.sql"


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


async def _legacy_state() -> str:
    """'fresh', 'alembic', 'legacy' (Node.js schema, complete) or 'legacy-incomplete'."""
    from app.db import connect_args

    engine = create_async_engine(settings.sqlalchemy_url, poolclass=NullPool, connect_args=connect_args())
    try:
        async with engine.connect() as conn:
            has_alembic = await conn.scalar(text("SELECT to_regclass('public.alembic_version') IS NOT NULL"))
            if has_alembic:
                return "alembic"
            has_legacy = await conn.scalar(text("SELECT to_regclass('public.schema_migrations') IS NOT NULL"))
            if not has_legacy:
                return "fresh"
            done = await conn.scalar(text("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = :n)"), {"n": LEGACY_COMPLETE})
            return "legacy" if done else "legacy-incomplete"
    finally:
        await engine.dispose()


def run_migrations() -> None:
    """Synchronous; call from a worker thread (Alembic runs its own event loop)."""
    state = asyncio.run(_legacy_state())
    cfg = _alembic_config()
    if state == "legacy-incomplete":
        raise RuntimeError("This database was created by an older Node.js version and is not fully migrated. Run that version once, or restore a newer backup.")
    if state == "legacy":
        command.stamp(cfg, "0001")
    command.upgrade(cfg, "head")

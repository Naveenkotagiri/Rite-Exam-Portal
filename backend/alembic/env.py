"""Alembic environment: runs migrations on the async engine from app.config."""

import asyncio

from alembic import context
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models import Base

target_metadata = Base.metadata
MIGRATION_LOCK = 727001  # same advisory lock the Node.js server used, so two servers never migrate at once


def run_migrations_offline() -> None:
    context.configure(url=settings.sqlalchemy_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:
    connection.execute(text(f"SELECT pg_advisory_xact_lock({MIGRATION_LOCK})"))
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    from app.db import connect_args

    engine = create_async_engine(settings.sqlalchemy_url, poolclass=NullPool, connect_args=connect_args())
    async with engine.begin() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())

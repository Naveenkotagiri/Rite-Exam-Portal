"""Database access for requests.

Queries are plain SQL with named parameters (`:name`), run directly on an asyncpg connection pool
(SQLAlchemy is used for the table models and Alembic migrations, not on the request path, because
its per-query overhead limits how many students one server can handle). Each standalone call runs
on its own (autocommit); `transaction()` groups statements so they commit or roll back together.
Rows come back as plain dicts; numeric values as floats; json/jsonb as Python objects.
"""

import asyncio
import json
import re
import ssl
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal
from functools import lru_cache
from typing import Any

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()


def _dsn() -> str:
    return settings.sqlalchemy_url.replace("postgresql+asyncpg://", "postgresql://", 1)


def _ssl() -> ssl.SSLContext | None:
    return ssl.create_default_context() if settings.database_ssl else None


async def _init_connection(conn: asyncpg.Connection) -> None:
    # Parameters given as already-serialised strings pass through unchanged (CAST(:x AS jsonb)).
    encode = lambda value: value if isinstance(value, str) else json.dumps(value)  # noqa: E731
    for type_name in ("json", "jsonb"):
        await conn.set_type_codec(type_name, encoder=encode, decoder=json.loads, schema="pg_catalog")


async def pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        async with _pool_lock:
            if _pool is None:
                _pool = await asyncpg.create_pool(_dsn(), ssl=_ssl(), min_size=2, max_size=20, init=_init_connection)
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


_PARAM = re.compile(r"(?<![:\w]):([A-Za-z_]\w*)")


@lru_cache(maxsize=512)
def _positional(sql: str) -> tuple[str, tuple[str, ...]]:
    """Rewrites :name parameters to asyncpg's $1, $2... (casts like ::int are left alone)."""
    names: list[str] = []

    def number(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in names:
            names.append(name)
        return f"${names.index(name) + 1}"

    return _PARAM.sub(number, sql), tuple(names)


def _args(sql: str, params: dict[str, Any]) -> tuple[str, list[Any]]:
    query, names = _positional(sql)
    return query, [params[name] for name in names]


def _plain(value: Any) -> Any:
    # numeric columns arrive as Decimal; marks and scores are small, so floats are exact enough
    return float(value) if isinstance(value, Decimal) else value


def _row(record: asyncpg.Record) -> dict[str, Any]:
    return {key: _plain(val) for key, val in record.items()}


class Db:
    """Runs SQL on one connection."""

    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    async def all(self, sql: str, **params: Any) -> list[dict[str, Any]]:
        query, args = _args(sql, params)
        return [_row(r) for r in await self.conn.fetch(query, *args)]

    async def one(self, sql: str, **params: Any) -> dict[str, Any] | None:
        query, args = _args(sql, params)
        record = await self.conn.fetchrow(query, *args)
        return _row(record) if record is not None else None

    async def value(self, sql: str, **params: Any) -> Any:
        query, args = _args(sql, params)
        return _plain(await self.conn.fetchval(query, *args))

    async def run(self, sql: str, **params: Any) -> int:
        """Executes a statement and returns the number of rows it changed."""
        query, args = _args(sql, params)
        status = await self.conn.execute(query, *args)  # e.g. "UPDATE 3", "INSERT 0 1"
        last = status.rsplit(" ", 1)[-1]
        return int(last) if last.isdigit() else 0


@asynccontextmanager
async def transaction() -> AsyncIterator[Db]:
    async with (await pool()).acquire() as conn, conn.transaction():
        yield Db(conn)


@asynccontextmanager
async def _single() -> AsyncIterator[Db]:
    async with (await pool()).acquire() as conn:
        yield Db(conn)


async def all(sql: str, **params: Any) -> list[dict[str, Any]]:  # noqa: A001 - mirrors Db.all
    async with _single() as db:
        return await db.all(sql, **params)


async def one(sql: str, **params: Any) -> dict[str, Any] | None:
    async with _single() as db:
        return await db.one(sql, **params)


async def value(sql: str, **params: Any) -> Any:
    async with _single() as db:
        return await db.value(sql, **params)


async def run(sql: str, **params: Any) -> int:
    async with _single() as db:
        return await db.run(sql, **params)


def connect_args() -> dict[str, Any]:
    """SSL settings for SQLAlchemy engines (used by Alembic)."""
    return {"ssl": _ssl()} if settings.database_ssl else {}

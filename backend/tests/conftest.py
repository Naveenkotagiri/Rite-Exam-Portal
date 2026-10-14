"""Test setup: a fresh exam_test database, an in-process API client, and small data builders."""

import os

os.environ["APP_ENV"] = "test"

import asyncio
import json
from itertools import count

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app import db
from app.config import settings
from app.core import rate_limit
from app.core.security import hash_password
from app.main import create_app
from app.migrate import run_migrations

ADMIN = {"email": "admin@test.local", "password": "Secret@123"}
TABLES = "admins, exams, sections, passages, questions, drives, students, attempts, answers, attempt_events, snapshots"


@pytest.fixture(scope="session", autouse=True)
def fresh_schema():
    """Rebuilds the test database from the migrations once per run (this also tests a fresh install)."""

    async def drop() -> None:
        engine = create_async_engine(settings.sqlalchemy_url, poolclass=NullPool)
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await engine.dispose()

    asyncio.run(drop())
    run_migrations()


@pytest.fixture(autouse=True)
async def clean_db():
    await db.run(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE")
    await db.run("INSERT INTO admins (name, email, password_hash) VALUES ('Test Admin', :e, :h)", e=ADMIN["email"], h=hash_password(ADMIN["password"]))
    for limiter in (rate_limit.register_limit, rate_limit.result_limit, rate_limit.login_limit):
        limiter.hits.clear()


APP = create_app(run_lifespan=False)


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=APP), base_url="http://test")


@pytest.fixture
async def api():
    """An API client with no login: a student's browser."""
    async with _client() as client:
        yield client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def admin():
    """A separate API client logged in as the test admin."""
    async with _client() as client:
        r = await client.post("/api/admin/login", json=ADMIN)
        assert r.status_code == 200
        client.headers.update(auth(r.json()["token"]))
        yield client


async def make_exam(negative_marks: float = 0, duration_min: int = 60) -> dict:
    """3 synonym questions and a 2-question passage. Correct answers: B, A, B, C, D (indexes 1, 0, 1, 2, 3)."""
    exam = await db.value("INSERT INTO exams (title, duration_min, negative_marks) VALUES ('Test exam', :d, :n) RETURNING id", d=duration_min, n=negative_marks)
    s1 = await db.value("INSERT INTO sections (exam_id, name, position) VALUES (:e, 'Synonyms', 1) RETURNING id", e=exam)
    s2 = await db.value("INSERT INTO sections (exam_id, name, position) VALUES (:e, 'Reading', 2) RETURNING id", e=exam)
    passage = await db.value("INSERT INTO passages (exam_id, title, body) VALUES (:e, 'P', 'Passage body') RETURNING id", e=exam)
    defs = [
        (s1, None, "Pragmatic", ["Idealistic", "Practical", "Emotional", "Theoretical"], 1),
        (s1, None, "Viable", ["Feasible", "Visible", "Temporary", "Expensive"], 0),
        (s1, None, "Arbitrary", ["Logical", "Random", "Necessary", "Strict"], 1),
        (s2, passage, "Purpose?", ["a", "b", "c", "d", "e"], 2),
        (s2, passage, "Impact?", ["a", "b", "c", "d", "e"], 3),
    ]
    ids = []
    for pos, (sid, pid, txt, options, correct) in enumerate(defs, start=1):
        ids.append(await db.value(
            """INSERT INTO questions (exam_id, section_id, passage_id, position, text, options, correct_index)
               VALUES (:e, :s, :p, :pos, :t, CAST(:o AS jsonb), :c) RETURNING id""",
            e=exam, s=sid, p=pid, pos=pos, t=txt, o=json.dumps(options), c=correct,
        ))
    return {"exam_id": exam, "question_ids": ids, "correct": [1, 0, 1, 2, 3], "passage_id": passage}


async def make_drive(exam_id: int, **fields) -> dict:
    cols = {"code": "test-drive", "name": "Test drive", "college": "Test College", "exam_id": exam_id, **fields}
    names = ", ".join(cols)
    binds = ", ".join(f":{k}" for k in cols)
    return await db.one(f"INSERT INTO drives ({names}) VALUES ({binds}) RETURNING *", **cols)


_n = count(1)


def student(**overrides) -> dict:
    n = next(_n)
    return {
        "firstName": "Asha", "middleName": "", "lastName": "Rao",
        "studentId": f"IBS{1000 + n}", "email": f"asha{n}@college.edu", "phone": f"98765{10000 + n:05d}"[-10:],
        **overrides,
    }


async def register(api, code: str = "test-drive", s: dict | None = None) -> dict:
    s = s or student()
    r = await api.post(f"/api/drives/{code}/register", json=s)
    assert r.status_code == 201, r.text
    return {"token": r.json()["token"], "student": s}

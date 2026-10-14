"""Initial schema: everything the Node.js version created in migrations 001-003.

Databases created by the Node.js version already have these tables; on start-up they are
adopted ("stamped" at this revision) without running this file. See app/migrate.py.

Revision ID: 0001
Revises:
Create Date: 2026-10-13
"""

import re
from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SQL = Path(__file__).resolve().parents[1] / "sql" / "0001_initial_schema.sql"


def upgrade() -> None:
    # asyncpg runs one statement per call. Comments are removed first (they may contain ";");
    # the file has no "--" or ";" inside string literals.
    sql = "\n".join(re.sub(r"--.*$", "", line) for line in SQL.read_text(encoding="utf-8").splitlines())
    for statement in sql.split(";"):
        if statement.strip():
            op.execute(statement.strip())


def downgrade() -> None:
    for table in ("snapshots", "attempt_events", "answers", "attempts", "students", "drives", "questions", "passages", "sections", "exams", "admins"):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

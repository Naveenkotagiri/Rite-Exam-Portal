"""A student's registration for a drive, their test attempt, answers, activity log and camera photos."""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, LargeBinary, Numeric, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (
        Index("students_drive_code", "drive_id", text("lower(student_code)"), unique=True),
        Index("students_drive_email", "drive_id", text("lower(email)"), unique=True),
        Index("students_drive_phone", "drive_id", "phone", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    drive_id: Mapped[int] = mapped_column(ForeignKey("drives.id", ondelete="CASCADE"))
    first_name: Mapped[str] = mapped_column(Text)
    middle_name: Mapped[str] = mapped_column(Text, server_default="")
    last_name: Mapped[str] = mapped_column(Text)
    student_code: Mapped[str] = mapped_column(Text)  # the college Student ID
    email: Mapped[str] = mapped_column(Text)
    phone: Mapped[str] = mapped_column(Text)
    user_agent: Mapped[str] = mapped_column(Text, server_default="")
    created_at: Mapped[datetime] = created_at()


class Attempt(Base):
    __tablename__ = "attempts"
    __table_args__ = (
        CheckConstraint("status IN ('registered', 'in_progress', 'submitted')", name="attempts_status_check"),
        CheckConstraint("result_status IN ('shortlisted', 'not_selected')", name="attempts_result_status_check"),
        Index("attempts_in_progress", "ends_at", postgresql_where=text("status = 'in_progress'")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), unique=True)
    token_hash: Mapped[str] = mapped_column(Text, unique=True)  # sha256 of the student's session token
    status: Mapped[str] = mapped_column(Text, server_default="registered")
    question_order: Mapped[list[int] | None] = mapped_column(JSONB)  # this student's paper
    option_orders: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # question id → shuffled option indexes
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submit_reason: Mapped[str | None] = mapped_column(Text)  # student | time_up | violations | coordinator
    score: Mapped[float | None] = mapped_column(Numeric(8, 2))
    max_score: Mapped[float | None] = mapped_column(Numeric(8, 2))
    section_scores: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    violations: Mapped[int] = mapped_column(Integer, server_default="0")  # times the student left the window
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    relogin_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    relogin_allowed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result_status: Mapped[str | None] = mapped_column(Text)
    result_manual: Mapped[bool] = mapped_column(Boolean, server_default="false")


class Answer(Base):
    __tablename__ = "answers"

    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True)
    selected: Mapped[int | None] = mapped_column(Integer)  # original option index
    marked_review: Mapped[bool] = mapped_column(Boolean, server_default="false")
    updated_at: Mapped[datetime] = created_at()


class AttemptEvent(Base):
    __tablename__ = "attempt_events"
    __table_args__ = (Index("attempt_events_attempt", "attempt_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(Text)
    detail: Mapped[str] = mapped_column(Text, server_default="")
    created_at: Mapped[datetime] = created_at()


class Snapshot(Base):
    __tablename__ = "snapshots"
    __table_args__ = (Index("snapshots_attempt", "attempt_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"))
    image: Mapped[bytes] = mapped_column(LargeBinary)  # JPEG
    created_at: Mapped[datetime] = created_at()

"""A question paper: exam → sections → questions, with optional reading passages."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at


class Exam(Base):
    __tablename__ = "exams"
    __table_args__ = (
        CheckConstraint("duration_min BETWEEN 1 AND 600", name="exams_duration_min_check"),
        CheckConstraint("negative_marks >= 0", name="exams_negative_marks_check"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    duration_min: Mapped[int] = mapped_column(Integer)
    instructions: Mapped[str] = mapped_column(Text, server_default="")
    negative_marks: Mapped[float] = mapped_column(Numeric(5, 2), server_default="0")
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Section(Base):
    __tablename__ = "sections"
    __table_args__ = (Index("sections_exam_name", "exam_id", text("lower(name)"), unique=True),)

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text)
    hint: Mapped[str] = mapped_column(Text, server_default="")
    position: Mapped[int] = mapped_column(Integer, server_default="0")


class Passage(Base):
    __tablename__ = "passages"
    __table_args__ = (Index("passages_exam_title", "exam_id", text("lower(title)"), unique=True),)

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (
        CheckConstraint("marks > 0", name="questions_marks_check"),
        Index("questions_exam", "exam_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"))
    section_id: Mapped[int] = mapped_column(ForeignKey("sections.id", ondelete="CASCADE"))
    passage_id: Mapped[int | None] = mapped_column(ForeignKey("passages.id", ondelete="SET NULL"))
    position: Mapped[int] = mapped_column(Integer, server_default="0")
    text: Mapped[str] = mapped_column(Text)
    options: Mapped[list[str]] = mapped_column(JSONB)  # 2–5 option texts
    correct_index: Mapped[int] = mapped_column(Integer)  # index into options: the answer key
    marks: Mapped[float] = mapped_column(Numeric(6, 2), server_default="1")

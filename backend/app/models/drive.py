"""A campus drive: one college visit that uses one exam, with its link, timing and proctoring rules."""

from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at


class Drive(Base):
    __tablename__ = "drives"
    __table_args__ = (
        CheckConstraint("snapshot_interval_sec BETWEEN 30 AND 600", name="drives_snapshot_interval_sec_check"),
        CheckConstraint("max_violations BETWEEN 0 AND 50", name="drives_max_violations_check"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(Text, unique=True)  # the end of the student link: /d/<code>
    name: Mapped[str] = mapped_column(Text)
    college: Mapped[str] = mapped_column(Text)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id", ondelete="RESTRICT"))
    drive_date: Mapped[date | None] = mapped_column(Date)
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_open: Mapped[bool] = mapped_column(Boolean, server_default="true")

    # Proctoring
    camera_required: Mapped[bool] = mapped_column(Boolean, server_default="true")
    snapshot_interval_sec: Mapped[int] = mapped_column(Integer, server_default="90")
    require_fullscreen: Mapped[bool] = mapped_column(Boolean, server_default="true")
    max_violations: Mapped[int] = mapped_column(Integer, server_default="3")  # auto-submit on this many; 0 = never
    require_seb: Mapped[bool] = mapped_column(Boolean, server_default="false")
    shuffle_questions: Mapped[bool] = mapped_column(Boolean, server_default="true")
    shuffle_options: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = created_at()

    # Results published to students (NULL published_at = hidden)
    results_published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    results_cutoff_pct: Mapped[float | None] = mapped_column(Numeric(5, 2))
    results_next_steps: Mapped[str] = mapped_column(Text, server_default="")
    results_other_message: Mapped[str] = mapped_column(Text, server_default="")

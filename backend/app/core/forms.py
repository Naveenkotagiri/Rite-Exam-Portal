"""Checks admin form input field by field and collects messages, so the screen can show each
problem next to its field. Raises 400 {"error": ..., "fields": {...}} from done()."""

from __future__ import annotations  # method names (str, int, date...) shadow types inside the class

import math
import re
from datetime import UTC, date, datetime
from typing import Any

from app.core.errors import bad_request

_MISSING = object()


def _present(value: Any) -> bool:
    return value is not None and value != ""


def to_number(value: Any) -> float:
    """Like JavaScript's Number(): numbers and numeric strings convert, anything else is NaN."""
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, int | float):
        return float(value)
    try:
        return float(str(value).strip())
    except ValueError:
        return math.nan


class Form:
    def __init__(self, body: dict[str, Any] | None):
        self.body = body or {}
        self.errors: dict[str, str] = {}

    def str(self, field: str, label: str, *, max: int = 200, required: bool = True) -> str:  # noqa: A002
        value = self.body.get(field)
        s = "" if value is None else str(value).strip()
        if required and not s:
            self.errors[field] = f"{label} is required."
        elif len(s) > max:
            self.errors[field] = f"{label} must be at most {max} characters."
        return s

    def int(self, field: str, label: str, lo: int, hi: int, fallback: Any = _MISSING) -> int | None:
        value = self.body.get(field)
        if not _present(value):
            if fallback is not _MISSING:
                return fallback
            self.errors[field] = f"{label} is required."
            return None
        n = to_number(value)
        if not math.isfinite(n) or not n.is_integer() or n < lo or n > hi:
            self.errors[field] = f"{label} must be a whole number from {lo} to {hi}."
            return None
        return int(n)

    def num(self, field: str, label: str, lo: float, hi: float, fallback: Any = None) -> float | None:
        value = self.body.get(field)
        if not _present(value):
            return fallback
        n = to_number(value)
        if not math.isfinite(n) or n < lo or n > hi:
            self.errors[field] = f"{label} must be between {_fmt(lo)} and {_fmt(hi)}."
            return None
        return n

    def bool(self, field: str, fallback: bool) -> bool:
        return fallback if field not in self.body else bool(self.body.get(field))

    def date(self, field: str, label: str) -> date | None:
        value = self.body.get(field)
        if not _present(value):
            return None
        s = str(value)
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
                raise ValueError
            return date.fromisoformat(s)
        except ValueError:
            self.errors[field] = f"{label} is not a valid date."
            return None

    def datetime(self, field: str, label: str) -> datetime | None:
        value = self.body.get(field)
        if not _present(value):
            return None
        try:
            d = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        except ValueError:
            self.errors[field] = f"{label} is not a valid date and time."
            return None
        return d if d.tzinfo else d.replace(tzinfo=UTC)

    def error(self, field: str, message: str) -> None:
        self.errors[field] = message

    def done(self) -> None:
        if self.errors:
            raise bad_request("Please correct the highlighted fields.", fields=self.errors)


def _fmt(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else str(n)

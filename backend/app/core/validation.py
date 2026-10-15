"""Student registration rules. Kept identical to frontend/src/shared/validation.js, which the browser form uses."""

import re
from typing import Any

NAME = re.compile(r"[A-Za-z][A-Za-z .'-]{0,49}")
STUDENT_ID = re.compile(r"[A-Z0-9/-]{3,30}")
EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}")
PHONE = re.compile(r"[6-9][0-9]{9}")


def _text(value: Any) -> str:
    return "" if value is None else str(value)


def _clean(value: Any) -> str:
    return " ".join(_text(value).split())


def normalize_phone(value: Any) -> str:
    phone = re.sub(r"[^0-9]", "", _text(value))
    if len(phone) == 12 and phone.startswith("91"):
        phone = phone[2:]
    if len(phone) == 11 and phone.startswith("0"):
        phone = phone[1:]
    return phone


def normalize_student_id(value: Any) -> str:
    return re.sub(r"\s", "", _clean(value)).upper()


def normalize_student(raw: dict[str, Any]) -> dict[str, str]:
    return {
        "firstName": _clean(raw.get("firstName")),
        "middleName": _clean(raw.get("middleName")),
        "lastName": _clean(raw.get("lastName")),
        "studentId": normalize_student_id(raw.get("studentId")),
        "email": _clean(raw.get("email")).lower(),
        "phone": normalize_phone(raw.get("phone")),
    }


def valid_phone(phone: str) -> bool:
    return bool(PHONE.fullmatch(phone))


def validate_student(s: dict[str, str]) -> dict[str, str]:
    """Returns {field: message} for every invalid field; empty when valid."""
    errors: dict[str, str] = {}
    if not NAME.fullmatch(s["firstName"]):
        errors["firstName"] = "Enter your first name (letters only)."
    if s["middleName"] and not NAME.fullmatch(s["middleName"]):
        errors["middleName"] = "Letters only."
    if not NAME.fullmatch(s["lastName"]):
        errors["lastName"] = "Enter your last name (letters only)."
    if not STUDENT_ID.fullmatch(s["studentId"]):
        errors["studentId"] = "Enter your Student ID (3–30 letters or digits)."
    if not EMAIL.fullmatch(s["email"]) or len(s["email"]) > 254:
        errors["email"] = "Enter a valid email address."
    if not valid_phone(s["phone"]):
        errors["phone"] = "Enter a valid 10-digit mobile number."
    return errors

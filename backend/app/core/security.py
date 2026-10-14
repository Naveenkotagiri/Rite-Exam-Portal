"""Passwords, admin login tokens (JWT) and student session tokens.

Formats match the Node.js version, so existing passwords and logins keep working.
"""

import hashlib
import hmac
import os
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.config import settings

ADMIN_SESSION = timedelta(hours=12)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = str(stored).split("$")
        expected = bytes.fromhex(digest)
        if scheme != "scrypt":
            return False
        actual = hashlib.scrypt(str(password).encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=len(expected))
    except ValueError:
        return False
    return hmac.compare_digest(actual, expected)


def sign_admin(admin: dict[str, Any]) -> str:
    now = datetime.now(UTC)
    claims = {"sub": str(admin["id"]), "name": admin["name"], "email": admin["email"], "iat": now, "exp": now + ADMIN_SESSION}
    return jwt.encode(claims, settings.signing_secret, algorithm="HS256")


def read_admin_token(token: str) -> dict[str, Any] | None:
    try:
        claims = jwt.decode(token, settings.signing_secret, algorithms=["HS256"])
        return {"id": int(claims["sub"]), "name": claims.get("name"), "email": claims.get("email")}
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def new_token() -> str:
    """Random token handed to a student's browser; only its hash is stored."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

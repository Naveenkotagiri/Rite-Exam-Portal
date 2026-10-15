"""Settings, read from environment variables and backend/.env."""

import os
from functools import cached_property
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
# The built website, served by the backend when it runs on its own (development, tests). In production nginx
# serves frontend/dist itself, and this folder may not exist.
DIST_DIR = PROJECT_DIR / "frontend" / "dist"
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    # In production systemd passes backend/.env to the process; the service user cannot (and need not) read the
    # file itself, so it is only read here when readable.
    model_config = SettingsConfigDict(env_file=ENV_FILE if os.access(ENV_FILE, os.R_OK) else None, extra="ignore")

    app_env: str = "development"  # development | test | production
    port: int = 3000
    database_url: str = "postgres://exam:exam@localhost:5432/exam"
    test_database_url: str = "postgres://exam:exam@localhost:5432/exam_test"
    database_ssl: bool = False
    jwt_secret: str = ""

    # First admin, created on start-up when there are no admins yet.
    admin_name: str = "Administrator"
    admin_email: str = ""
    admin_password: str = ""

    # Answers and submissions are still accepted this long after the timer ends (network lag).
    grace_seconds: int = 30

    @property
    def is_prod(self) -> bool:
        return self.app_env == "production"

    @property
    def is_test(self) -> bool:
        return self.app_env == "test"

    @cached_property
    def sqlalchemy_url(self) -> str:
        """The configured postgres:// URL, rewritten for SQLAlchemy's asyncpg driver."""
        url = self.test_database_url if self.is_test else self.database_url
        for prefix in ("postgresql+asyncpg://", "postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+asyncpg://" + url[len(prefix):]
        return url

    @cached_property
    def signing_secret(self) -> str:
        if self.jwt_secret:
            return self.jwt_secret
        if self.is_prod:
            raise RuntimeError("JWT_SECRET must be set in production.")
        return "dev-only-secret-do-not-use-in-production"


settings = Settings()

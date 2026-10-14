"""Settings, read from environment variables (and the project's .env file in development)."""

from functools import cached_property
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
DIST_DIR = PROJECT_DIR / "dist"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_DIR / ".env", extra="ignore")

    app_env: str = "development"  # development | test | production
    port: int = 3000
    database_url: str = "postgres://exam:exam@localhost:5440/exam"
    test_database_url: str = "postgres://exam:exam@localhost:5440/exam_test"
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

"""Simple per-IP request limits (in memory, per server process), used as FastAPI dependencies."""

import time

from fastapi import Request

from app.core.errors import HttpError


class RateLimit:
    def __init__(self, limit: int, window_seconds: int, message: str = "Too many requests, please try again later."):
        self.limit = limit
        self.window = window_seconds
        self.message = message
        self.hits: dict[str, tuple[int, int]] = {}  # ip → (window number, count)

    async def __call__(self, request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        window = int(time.time() // self.window)
        last_window, count = self.hits.get(ip, (window, 0))
        count = count + 1 if last_window == window else 1
        self.hits[ip] = (window, count)
        if len(self.hits) > 50_000:  # forget old windows now and then
            self.hits = {k: v for k, v in self.hits.items() if v[0] == window}
        if count > self.limit:
            raise HttpError(429, self.message)


# A whole campus often shares one public IP, so student limits are generous.
register_limit = RateLimit(600, 60)
result_limit = RateLimit(300, 60, "Too many attempts. Please wait a minute and try again.")
login_limit = RateLimit(30, 15 * 60, "Too many login attempts. Please wait a few minutes.")

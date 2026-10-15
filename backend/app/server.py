"""Starts the production server: python -m app.server

Set WEB_CONCURRENCY to run several worker processes on a bigger machine.
"""

import os

import uvicorn

from app.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("HOST", "0.0.0.0"),  # noqa: S104 - the server must accept outside connections
        port=settings.port,
        workers=int(os.environ.get("WEB_CONCURRENCY", "1")),
        # Real client IPs (for rate limits) from X-Forwarded-For, trusted only when it comes from nginx on this
        # server; trusting every sender would let anyone claim a fresh IP and skip the login limit.
        proxy_headers=True,
        forwarded_allow_ips=os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1"),
        server_header=False,
        log_level="warning",
    )

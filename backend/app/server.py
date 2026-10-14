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
        proxy_headers=True,  # real client IPs behind a load balancer, for rate limits
        forwarded_allow_ips="*",
        server_header=False,
        log_level="warning",
    )

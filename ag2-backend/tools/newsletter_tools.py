"""Optional, explicitly configured newsletter integration with a session budget."""

import asyncio
import logging
import os
import re
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger("uvicorn.error")
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def create_newsletter_tool(endpoint: str, *, max_signups: int | None = None, client_factory=httpx.AsyncClient):
    url = urlsplit(endpoint)
    if not url.hostname or url.username or url.password or (
        url.scheme != "https" and not (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1"))
    ):
        raise ValueError("NEWSLETTER_API_URL must be HTTPS (or a loopback HTTP address).")
    limit = max(0, min(20, int(max_signups if max_signups is not None else os.getenv("NEWSLETTER_MAX_PER_SESSION", "5"))))
    attempts = 0
    lock = asyncio.Lock()

    async def subscribe_to_newsletter(email: str) -> str:
        """Subscribe an email to the configured newsletter, only on the host's explicit request."""
        nonlocal attempts
        email = email.strip()
        if len(email) > 254 or not _EMAIL_RE.fullmatch(email):
            return "Please provide a valid email address."
        async with lock:
            if attempts >= limit:
                return "Newsletter signup limit reached for this cohost session."
            # Count attempts too: a failed service must not cause unbounded retries.
            attempts += 1
            try:
                async with client_factory(timeout=10) as client:
                    response = await client.post(endpoint, json={"email": email, "source": "ai_cohost"})
                    response.raise_for_status()
                    data = response.json()
                if not isinstance(data, dict):
                    return "The newsletter service did not confirm a new subscription."
            except Exception:
                logger.warning("Newsletter request failed; no successful signup was confirmed.")
                return "The newsletter service did not confirm a signup. Please try again later."
        if data.get("created") is True and not data.get("error"):
            return "The newsletter service confirmed the subscription."
        return "The newsletter service did not confirm a new subscription."

    return subscribe_to_newsletter

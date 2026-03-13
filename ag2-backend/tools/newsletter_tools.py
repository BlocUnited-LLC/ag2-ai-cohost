import os
import re
import time
import logging
from typing import Annotated

import httpx

logger = logging.getLogger("uvicorn.error")

# ---------------------------------------------------------------------------
# Configuration — set via environment variables
# ---------------------------------------------------------------------------
NEWSLETTER_API_URL = os.getenv(
    "NEWSLETTER_API_URL",
    "https://website-email-functions7482.azurewebsites.net/api/newsletter/subscribe",
)

# Per-session rate limit (protects against abuse from the agent side)
_MAX_SIGNUPS_PER_SESSION = int(os.getenv("NEWSLETTER_MAX_PER_SESSION", "5"))
_session_signup_count = 0
_session_start = time.monotonic()

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _reset_session_if_stale() -> None:
    """Reset the session counter after 1 hour."""
    global _session_signup_count, _session_start
    if time.monotonic() - _session_start > 3600:
        _session_signup_count = 0
        _session_start = time.monotonic()


def subscribe_to_newsletter(
    email: Annotated[str, "The email address to subscribe to the newsletter"],
) -> str:
    """Subscribe an email address to the BlocUnited newsletter.

    Only use this when the streamer explicitly asks you to add someone.
    Do NOT subscribe emails mentioned casually in chat.
    """
    global _session_signup_count

    _reset_session_if_stale()

    # --- Validate email format ---
    if not email or not _EMAIL_RE.match(email.strip()):
        return f"'{email}' is not a valid email address."

    # --- Rate limit ---
    if _session_signup_count >= _MAX_SIGNUPS_PER_SESSION:
        return (
            f"Rate limit reached ({_MAX_SIGNUPS_PER_SESSION} signups this session). "
            "Try again later."
        )

    email = email.strip()

    # --- Call the existing newsletter API ---
    try:
        response = httpx.post(
            NEWSLETTER_API_URL,
            json={"email": email, "source": "ai_cohost"},
            headers={"Content-Type": "application/json"},
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as exc:
        logger.error(f"[NEWSLETTER] API returned {exc.response.status_code}: {exc.response.text}")
        return "Sorry, the newsletter service returned an error. Try again later."
    except Exception as exc:
        logger.error(f"[NEWSLETTER] Request failed: {exc}")
        return "Sorry, I couldn't reach the newsletter service right now."

    _session_signup_count += 1

    if data.get("created") is False:
        return f"{email} is already subscribed to the newsletter!"

    return f"{email} has been subscribed to the BlocUnited newsletter!"

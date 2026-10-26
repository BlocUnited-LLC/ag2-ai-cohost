# Placeholder API layer
# Replace with Twitch/Kick/YouTube moderation APIs


def timeout_user(
    username: str,
    duration: int = 60,
) -> str:
    """Timeout a user from chat."""
    return "Chat moderation is not connected. No user was timed out."


def ban_user(
    username: str,
) -> str:
    """Permanently ban a user from chat."""
    return "Chat moderation is not connected. No user was banned."


def delete_message(
    message_id: str,
) -> str:
    """Delete a specific chat message."""
    return "Chat moderation is not connected. No message was deleted."

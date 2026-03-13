from typing import Annotated

# Placeholder API layer
# Replace with Twitch/Kick/YouTube moderation APIs


def timeout_user(
    username: Annotated[str, "The username to timeout from chat"],
    duration: Annotated[int, "Duration of timeout in seconds"] = 60,
) -> str:
    """Timeout a user from chat."""
    print(f"[MODERATION] Timeout {username} for {duration}s")
    return f"{username} has been timed out for {duration} seconds."


def ban_user(
    username: Annotated[str, "The username to permanently ban"],
) -> str:
    """Permanently ban a user from chat."""
    print(f"[MODERATION] Ban {username}")
    return f"{username} has been banned."


def delete_message(
    message_id: Annotated[str, "The ID of the message to delete"],
) -> str:
    """Delete a specific chat message."""
    print(f"[MODERATION] Delete message {message_id}")
    return f"Message {message_id} deleted."

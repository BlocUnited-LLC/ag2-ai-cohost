"""Safety guard for tool/function calling.

Only actions listed in ALLOWED_ACTIONS can be invoked by the agent.
Add or remove entries to control which tools the LLM is permitted to call.
"""

ALLOWED_ACTIONS = [
    "timeout_user",
    "delete_message",
    "trigger_overlay",
    "play_sound",
    "subscribe_to_newsletter",
]


def is_action_allowed(action_name: str) -> bool:
    """Return True if the given action is in the allow-list."""
    return action_name in ALLOWED_ACTIONS

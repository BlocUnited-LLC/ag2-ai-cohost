"""Safety guard for tool/function calling.

Only actions listed in ALLOWED_ACTIONS can be invoked by the agent.
Add or remove entries to control which tools the LLM is permitted to call.
"""

ALLOWED_ACTIONS = [
    "web_search",
    "research",
    "subscribe_to_newsletter",
]


def is_action_allowed(action_name: str, enabled_actions=("web_search",)) -> bool:
    """Return True if the given action is in the allow-list."""
    return action_name in ALLOWED_ACTIONS and action_name in enabled_actions

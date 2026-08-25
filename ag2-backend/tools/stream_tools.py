def change_stream_title(
    title: str,
) -> str:
    """Change the stream title."""
    print(f"[STREAM] Changing title to: {title}")
    return f"Stream title updated to '{title}'."


def trigger_overlay(
    animation: str,
) -> str:
    """Trigger an OBS overlay animation."""
    print(f"[STREAM] Trigger overlay: {animation}")
    return f"Overlay '{animation}' triggered."


def play_sound(
    sound_name: str,
) -> str:
    """Play a sound effect on stream."""
    print(f"[STREAM] Playing sound: {sound_name}")
    return f"Sound '{sound_name}' played."

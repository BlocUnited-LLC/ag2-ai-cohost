# Agent configuration and tools

Runtime AI settings live in `ag2-backend/OAI_CONFIG_LIST`. The real file contains the
API key and is ignored by Git; use `ag2-backend/OAI_CONFIG_LIST_sample` as the public
template.

## Agent prompt and contacts

```json
{
  "agent_prompt": "You are a warm, curious AI cohost. Have a natural conversation and answer whatever the user wants to know. Be concise but useful, point out practical value when it helps, and ask thoughtful follow-up questions without sounding scripted.",
  "contacts": {
    "primary": {
      "name": "BlocUnited",
      "context": "BlocUnited is the team behind Mozaiks and builds open-source tools for creating AI-native software.",
      "websites": ["https://blocunited.com/"]
    },
    "secondary": [
      {
        "name": "Mozaiks",
        "context": "Mozaiks is an open-source AI app factory that helps people move from an idea to working AI-native software faster while retaining the flexibility and control of an open-source platform.",
        "websites": [
          "https://www.mozaiks.ai/",
          "https://docs.mozaiks.ai/",
          "https://github.com/BlocUnited-LLC/mozaiks"
        ]
      }
    ]
  },
  "web_search_model": "gpt-5-mini",
  "web_search_limit": 10
}
```

`agent_prompt` controls the cohost's identity, tone, opening line, and conversational
behavior. Restart the AG2 backend after changing it.

Every contact uses the deterministic fields `name`, `context`, and `websites`. Write
`context` as natural background knowledge with the value propositions the cohost
should understand. `websites` accepts any number of relevant pages without assigning
fixed roles such as documentation or repository. `primary` and `secondary` organize
the configuration but are never spoken to the user.

The cohost remains a general conversational agent. Contact context is used only when
relevant, while current or detailed questions can trigger web research that favors
the configured websites. `web_search_limit` applies per voice session.

## Tools and function calling

The following tools are attached to `LiveAgent` in
`ag2-backend/realtime_over_webrtc/main.py`:

| Tool | Current implementation |
| --- | --- |
| `timeout_user(username, duration)` | Placeholder: logs a chat timeout request |
| `ban_user(username)` | Placeholder: logs a chat ban request |
| `delete_message(message_id)` | Placeholder: logs a message deletion request |
| `change_stream_title(title)` | Placeholder: logs a stream-title change |
| `trigger_overlay(animation)` | Placeholder: logs an overlay request |
| `play_sound(sound_name)` | Placeholder: logs a sound-effect request |
| `subscribe_to_newsletter(email)` | Makes a real HTTP request to the newsletter service |
| `web_search(query)` | Uses OpenAI web search, with a configurable per-session limit |

Implementations are in [the tools directory](../ag2-backend/tools/). The placeholder
functions return confirmation text but do not perform platform actions. Connect them
to the appropriate Twitch, Kick, YouTube, OBS, or other APIs to enable those actions.

The newsletter tool defaults to BlocUnited's newsletter service. Set
`NEWSLETTER_API_URL` in the backend environment to use your own endpoint; it receives
a JSON POST with `email` and `source: "ai_cohost"`. Use this tool only when a person
explicitly asks to subscribe.

Tools are registered in `ag2-backend/realtime_over_webrtc/main.py`, through `TOOLS`
and the session's web-search tool. The helper in `ag2-backend/tools/safety.py` is
currently not wired into that registration path; changing its allow-list does not
disable tools in a live session.

[Back to the README](../README.md)

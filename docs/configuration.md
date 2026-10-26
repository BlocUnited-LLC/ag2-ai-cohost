# Agent configuration and tools

Runtime AI settings live in `ag2-backend/OAI_CONFIG_LIST`. This is a JSON array;
the backend uses its first object. The real file contains your API key and is
ignored by Git. Start from the [public sample](../ag2-backend/OAI_CONFIG_LIST_sample).

The backend reads this file when a new cohost conversation starts. After changing
it, click **Stop cohost**, then **Start cohost** to apply the settings. Reloading an
overlay reconnects to the existing conversation and does not apply a new persona.

## Voice and model

```json
[
  {
    "api_key": "<your OpenAI API key here>",
    "model": "gpt-realtime-2",
    "voice": "coral",
    "agent_prompt": "You are a warm, curious AI cohost. Be concise, useful, and conversational.",
    "enabled_tools": ["web_search"],
    "web_search_model": "gpt-5-mini",
    "web_search_limit": 10
  }
]
```

`model` selects the realtime voice model and `voice` selects its voice. The values
above are the repository defaults; your API account must have access to the models
you configure. Realtime conversation and research incur provider usage separately.
Start a new conversation after changing the voice or model.

The optional `organization`, `project`, and `base_url` fields are passed to the
OpenAI clients. Use a compatible endpoint when overriding `base_url`; the voice
transport and research tools require the respective realtime and Responses APIs.

## Agent prompt and contacts

`agent_prompt` controls the cohost's identity, tone, and conversational style.
Keep it focused on the character and conversation. The application adds instructions
for the capabilities that are actually enabled.

The optional `contacts` object provides background knowledge and preferred reference
pages. Add it inside the configuration object:

```json
"contacts": {
  "primary": {
    "name": "Your project",
    "context": "What the project does and why it is useful to your audience.",
    "websites": ["https://example.com"]
  },
  "secondary": [
    {
      "name": "A related subject",
      "context": "Relevant background the cohost should understand.",
      "websites": ["https://example.com/about", "https://example.com/docs"]
    }
  ]
}
```

Each contact uses `name`, `context`, and `websites`. Write `context` as natural
background knowledge rather than dialogue for the cohost to repeat. The websites
are preferred sources when a relevant question needs research. `primary` and
`secondary` organize the configuration and are not labels to read aloud.

## Tools and function calling

`enabled_tools` selects which capabilities the voice agent receives. Omitting it
enables only `web_search`; an empty array disables all optional tools. Unknown or
unimplemented names cause startup to fail with a configuration error.

| Capability | Behavior | Configuration |
| --- | --- | --- |
| `web_search` | Searches the public web and returns a concise answer with sources. Enabled by default. | `web_search_model` defaults to `gpt-5-mini`; `web_search_limit` defaults to 10 attempts per conversation. |
| `research` | Delegates a focused question or show-notes request to a bounded AG2 text helper. Disabled by default. | `research_model` falls back to `web_search_model`; `research_limit` defaults to 3 delegations per conversation and is bounded to 0–10. |
| `subscribe_to_newsletter` | Sends a real signup request to an explicitly configured service. Disabled by default. | Requires `NEWSLETTER_API_URL` in the backend environment. |

For example, to enable research alongside direct searches:

```json
"enabled_tools": ["web_search", "research"],
"research_model": "gpt-5-mini",
"research_limit": 3,
"web_search_model": "gpt-5-mini",
"web_search_limit": 10
```

Research runs one delegation at a time, uses a 45-second turn deadline and a bounded
context, and shares the conversation's search budget with `web_search`. Its task
progress appears in the control page. This is a focused helper exposed through
`Agent.as_tool`; it does not enable the full LiveAgent Tasks interface or a general
filesystem/shell harness. Enabling `research` alone still lets that helper use its
internal search tool.

Chat moderation, stream-title changes, OBS scene control, overlays, and sound-effect
actions are not connected. Their placeholder files remain as integration starting
points but are not registered as live capabilities. Tool registration and validation
are in [capabilities.py](../ag2-backend/tools/capabilities.py) and
[safety.py](../ag2-backend/tools/safety.py).

### Optional newsletter service

Add `subscribe_to_newsletter` to `enabled_tools` and set `NEWSLETTER_API_URL` before
starting the backend. There is no default service endpoint. The URL must use HTTPS,
or HTTP on a loopback address for local testing. The tool sends:

```json
{"email": "person@example.com", "source": "ai_cohost"}
```

The service must return a successful HTTP response with JSON containing
`"created": true` and no truthy `error` field before the cohost reports a confirmed
subscription. Other responses, including `"created": false`, are not treated as a
new signup. The tool is intended only for an explicit request from the host.

`NEWSLETTER_MAX_PER_SESSION` defaults to 5 attempts per conversation, is bounded to
0–20, and counts failed attempts too. Set it to 0 to prevent signup attempts. Each
request has a 10-second timeout. Tests use a simulated service and create no real
subscriptions. See [newsletter_tools.py](../ag2-backend/tools/newsletter_tools.py).

## Local services and access

The normal setup uses two services on the same computer:

| Service | Default address | Purpose |
| --- | --- | --- |
| Node web server | `http://127.0.0.1:3001` | Serves `/control` and `/overlay`, and proxies local API/WebSocket traffic. |
| Python backend | `http://127.0.0.1:5050` | Owns the single conversation, provider credentials, and controller/viewer access. |

Open `http://localhost:3001/control` and copy its private overlay link into OBS.
The controller captures the microphone; an overlay receives audio and captions
without microphone permission. Only one controller can own the conversation.

The Node server accepts `PORT` (default `3001`), `HOST` (default `127.0.0.1`), and
`AG2_BACKEND_URL` (default `http://127.0.0.1:5050`). The standard backend startup
script uses port `5050`. Both services check the request Host and browser Origin;
the backend permits the default `localhost` and `127.0.0.1` origins on ports 3001
and 5050.

If you use another local frontend port, add its exact origins to
`COHOST_ALLOWED_ORIGINS` in both service environments. For example, port 3101 uses
`http://localhost:3101,http://127.0.0.1:3101`. Entries are comma-separated origins
without paths or trailing slashes. Keep the normal loopback bindings; this setup
does not provide a hosted multi-user authentication system.

Controller and viewer tokens are generated when the Python backend starts. The
overlay carries its viewer token after `#token=` in its URL and cannot control the
conversation or upload microphone audio. Keep overlay links out of public logs and
screenshots. Environment changes require restarting the affected service; after a
Python backend restart, reload the control page and copy its new overlay URL into
OBS. Restarting only the Node web server does not rotate backend tokens.

Microphone selection, mute, interruption, local monitoring, and OBS audio routing
are covered in the [usage guide](usage.md).

[Back to the README](../README.md)

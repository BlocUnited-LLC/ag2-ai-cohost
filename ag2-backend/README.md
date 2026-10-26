# AG2 Cohost backend

This FastAPI service owns one shared AG2 LiveAgent conversation. A separate
controller page sends microphone audio; any connected OBS overlays receive the
same generated audio, captions, and state. Opening or reloading an overlay does
not create a second provider session.

Use the [main setup guide](../README.md#quick-start) to install and run the complete
application. From the repository root:

```bash
npm install
npm run setup
```

Edit `ag2-backend/OAI_CONFIG_LIST` using the
[sample configuration](OAI_CONFIG_LIST_sample), then start these commands in
separate terminals:

```bash
npm run start:ag2
```

```bash
npm start
```

Open `http://localhost:3001/control`, choose a microphone, and click **Start
cohost**. Copy the private overlay URL from that page into an OBS Browser Source.
The Python service runs on loopback port 5050; the browser interface is served by
Node on port 3001. There is no separate backend chat page.

## Configuration and lifecycle

- Python **3.10+** is required. Dependencies pin AG2 to **1.2.1** and include the
  OpenAI realtime WebSocket transport. `npm run setup` installs them in the local
  `.venv` directory.
- API keys stay in the ignored `OAI_CONFIG_LIST` file. Configuration is read when
  a new conversation starts; use **Stop cohost** and **Start cohost** after edits.
- `enabled_tools` defaults to `web_search`. Optional bounded `research` and an
  explicitly configured newsletter integration are available. Placeholder
  moderation and stream-control tools are not registered.
- The backend authenticates controller and viewer connections separately. An
  overlay cannot upload microphone audio or start, stop, or interrupt a session.
- A disconnected controller has a 60-second reconnect window. Overlays can
  reconnect without restarting the conversation. Backend shutdown closes the
  provider and resets the conversation.
- Restarting the Python backend rotates the local access tokens. Reload the
  control page and update the OBS overlay URL after a restart.

See [configuration](../docs/configuration.md) for persona, contacts, tools, ports,
and origins; [usage](../docs/usage.md) for controls and OBS audio routing; and
[troubleshooting](../docs/troubleshooting.md) for connection and audio problems.

## Implementation and tests

The `realtime_over_webrtc` package name is retained from the earlier implementation.
Current browser transport is mono 24 kHz PCM over an authenticated WebSocket.
[main.py](realtime_over_webrtc/main.py) creates the application,
[session.py](realtime_over_webrtc/session.py) manages the shared conversation, and
[realtime.py](realtime_over_webrtc/realtime.py) adapts provider events and
interruption handling to AG2.

Run `npm run test:backend` from the repository root for backend unit tests, or
`npm test` for backend and browser coverage. Install the test browser once with
`npx playwright install chromium`. Tests use simulated providers and services;
they do not read your local API configuration or call OpenAI. See
[contribution checks](../CONTRIBUTING.md#check-your-change) for scope and manual OBS
acceptance.

## License

The bundled backend carries its own [Apache 2.0 license](LICENSE). See the
[repository license](../LICENSE) for the surrounding application.

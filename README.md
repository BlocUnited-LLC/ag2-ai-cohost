# AI Cohost

A browser-based AI avatar that listens through your microphone and talks back in real time — with lip-sync. Designed to be used as an OBS Browser Source for live streams and podcasts.

**How it works:** You speak → the AI responds with its voice → the 3D avatar's mouth moves in sync.

---

## What you need before starting

- [Node.js](https://nodejs.org) (v18 or later)
- [Python](https://www.python.org/downloads/) (v3.10 or later) — needed for the AI backend
- [Git](https://git-scm.com) — needed to clone the project
- An **OpenAI API key** with access to `gpt-realtime-2` — get one at [platform.openai.com](https://platform.openai.com)
- Chrome or Edge browser (required for microphone access)

---

## Setup (first time only)

### 1. Clone the repo

```bash
git clone https://github.com/BlocUnited-LLC/ag2-ai-cohost.git
cd ag2-ai-cohost
```

### 2. Install dependencies and set up the AI backend

This single command does everything: downloads the AI backend, creates a Python environment, and installs all required packages.

```bash
npm install
npm run setup
```

### 3. Add your OpenAI API key

Open the file `ag2-backend/OAI_CONFIG_LIST` in any text editor and replace `<your OpenAI API key here>` with your actual key:

```json
[
  {
    "model": "gpt-realtime-2",
    "api_key": "sk-proj-...",
    "voice": "coral"
  }
]
```

> **Keep this file private.** It is already in `.gitignore` so it will never be accidentally committed.

---

## Running the app

You need **two terminals** open at the same time.

**Terminal 1 — AI backend:**
```bash
npm run start:ag2
```

**Terminal 2 — Web server:**
```bash
npm start
```

Then open **http://localhost:3001** in Chrome or Edge.

---

## Using the app

1. The 3D avatar will appear on screen.
2. Click the **▶ Click to Start** button — this is required by the browser to enable audio.
3. Allow microphone access when the browser prompts you.
4. Start talking. The AI will respond and the avatar's mouth will move.

### Mic mute toggle

Press **`M`** to mute/unmute your mic to the AI. When muted:
- A red **"MIC OFF"** indicator appears in the top-left corner
- The AI receives no microphone audio — the LiveAgent connection stays alive
- Press **`M`** again to unmute instantly

You can also control this programmatically from the browser console:
```js
window.toggleMic()          // toggle
window.setMicMuted(true)    // mute
window.setMicMuted(false)   // unmute
```

---

## Using with OBS

1. In OBS, add a **Browser Source** to your scene.
2. Set the URL to `http://localhost:3001`.
3. Set the width/height to match your scene (e.g. 1280 × 720).
4. Check **Shutdown source when not visible** to save resources.

> Both servers (Terminal 1 and Terminal 2) must be running while you stream.

---

## Customising the AI persona

The AI's name, personality, and opening line are defined in `ag2-backend/realtime_over_webrtc/main.py`. Edit `BASE_SYSTEM_MESSAGE` to change how the AI behaves, then restart Terminal 1.

---

## Tool / function calling

The AI cohost can perform actions through tools passed to `LiveAgent` in `ag2-backend/realtime_over_webrtc/main.py`:

| Tool | Description |
|---|---|
| `timeout_user(username, duration)` | Timeout a chat user |
| `ban_user(username)` | Permanently ban a user |
| `delete_message(message_id)` | Delete a chat message |
| `change_stream_title(title)` | Update the stream title |
| `trigger_overlay(animation)` | Trigger an OBS overlay |
| `play_sound(sound_name)` | Play a sound effect |
| `subscribe_to_newsletter(email)` | Subscribe to the BlocUnited newsletter |
| `web_search(query)` | Search the public internet through OpenAI web search |

Tool implementations are in `ag2-backend/tools/`. Replace the placeholder functions with your actual platform APIs (Twitch, Kick, YouTube, etc.).

Company identity and web search are modular settings in `ag2-backend/OAI_CONFIG_LIST`:

```json
"company_name": "BlocUnited",
"company_website": "https://blocunited.com/",
"products": [
  {
    "name": "Mozaiks",
    "description": "An open-source AI app factory for building, running, and iterating on AI-native software products.",
    "website": "https://www.mozaiks.ai/",
    "documentation": "https://docs.mozaiks.ai/",
    "repository": "https://github.com/BlocUnited-LLC/mozaiks"
  }
],
"web_search_model": "gpt-5-mini",
"web_search_limit": 10
```

Change the company fields to reuse the cohost for another organization. Add any
number of entries to `products`; the agent will use each product's official sources
when researching it. The search limit applies per voice session and helps control
API usage.

The safety allow-list in `ag2-backend/tools/safety.py` controls which tools the agent is permitted to call.

---

## Troubleshooting

**Avatar loads but there's no audio / mic doesn't work**
- Make sure you clicked **▶ Click to Start** after the page loaded
- Check that you allowed microphone access — click the lock icon in the address bar to verify
- Confirm Terminal 1 (AG2 backend) is still running

**"AG2 backend unreachable" or connection errors**
- Make sure Terminal 1 is running (`npm run start:ag2`)
- Re-run `npm run setup` and confirm `ag2-backend/OAI_CONFIG_LIST` has a valid API key

**Avatar mouth doesn't move**
- Open the browser DevTools console (F12) and look for `[Avatar] HeadAudio lip-sync active.`
- If you see an error instead, try refreshing the page and clicking **▶ Click to Start** again

**Port 3001 already in use**
- Another app is using port 3001. Set a different port: `PORT=3002 npm start` and open `http://localhost:3002`

# AI Cohost

A browser-based AI avatar that listens through your microphone and talks back in real time — with lip-sync. Designed to be used as an OBS Browser Source for live streams and podcasts.

**How it works:** You speak → the AI responds with its voice → the 3D avatar's mouth moves in sync.

---

## What you need before starting

- [Node.js](https://nodejs.org) (v18 or later)
- [Python](https://www.python.org/downloads/) (v3.10 or later) — needed for the AI backend
- [Git](https://git-scm.com) — needed to clone the project
- An **OpenAI API key** with access to `gpt-4o-mini-realtime-preview` — get one at [platform.openai.com](https://platform.openai.com)
- Chrome or Edge browser (required for WebRTC mic access)

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
    "model": "gpt-4o-mini-realtime-preview",
    "api_key": "sk-proj-...",
    "tags": ["gpt-4o-mini-realtime", "realtime"]
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

---

## Using with OBS

1. In OBS, add a **Browser Source** to your scene.
2. Set the URL to `http://localhost:3001`.
3. Set the width/height to match your scene (e.g. 1280 × 720).
4. Check **Shutdown source when not visible** to save resources.

> Both servers (Terminal 1 and Terminal 2) must be running while you stream.

---

## Customising the AI persona

The AI's name, personality, and opening line are defined in `ag2-config/main.py`. Edit the `system_message` field to change how the AI behaves, then restart Terminal 1.

---

## Keeping the AI backend up to date

The `ag2-backend/` folder is a Git submodule pointing to the [AG2 upstream repo](https://github.com/ag2ai/realtime-agent-over-webrtc). To pull the latest changes:

```bash
git submodule update --remote ag2-backend
npm run setup
```

`npm run setup` re-applies your custom `main.py` after the update.

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

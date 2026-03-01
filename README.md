# AI Cohost (AG2 + TalkingHead + OBS)

A real-time AI podcast co-host built with:

- [AG2 RealtimeAgent](https://docs.ag2.ai/latest/docs/user-guide/advanced-concepts/realtime-agent/webrtc/) (Python/FastAPI backend, WebSocket signaling)
- [TalkingHead](https://github.com/met4citizen/TalkingHead) (Three.js 3D avatar — loads from CDN, no local file needed)
- [HeadAudio](https://github.com/met4citizen/HeadAudio) (audio-driven real-time lip-sync)
- OBS Browser Source

This project renders a live 3D avatar in the browser, streams real-time AI voice from AG2/OpenAI via WebRTC, performs lip-sync using HeadAudio, and integrates directly into OBS.

No Unity. No Unreal. No frontend frameworks.

---

## How It Works

This repository is the **browser-side client only**. It requires a separate AG2 Python backend.

```
Your Mic
  → AG2 RealtimeAgent  (Python/FastAPI, port 5050)
      ↕ WebSocket /session  ← signaling only
  → Express server  (Node.js, port 3000)  ← proxies /session + serves static files
      ↕ WebSocket proxy
  → Browser
      • RTCPeerConnection ↔ OpenAI Realtime API  (P2P audio)
      • HeadAudio → TalkingHead lip-sync
      • DataChannel → subtitle overlay
  → OBS Browser Source
```

Audio travels **peer-to-peer between the browser and OpenAI** — the AG2 Python backend handles only WebSocket signaling (ephemeral key exchange, session config). Express proxies that WebSocket so the browser talks to a single host.

---

## Project Structure

```
ai-cohost/
├── server.js                   Node.js dev server (static + WebSocket proxy)
├── package.json
├── ag2-cohost.md               Step-by-step implementation checklist
└── public/
    ├── index.html              OBS Browser Source entry point
    ├── css/
    │   └── styles.css
    ├── js/
    │   ├── webrtc.js           AG2 WebSocket signaling + WebRTC + DataChannel
    │   ├── avatar.js           TalkingHead + HeadAudio integration
    │   └── main.js             Bootstrap
    ├── libs/                   YOU MUST ADD these (see Setup)
    │   ├── headaudio.mjs       from github.com/met4citizen/HeadAudio
    │   ├── headworklet.mjs     from github.com/met4citizen/HeadAudio
    │   └── model-en-mixed.bin  from github.com/met4citizen/HeadAudio
    └── assets/                 YOU MUST ADD this
        └── avatar.glb          from avaturn.me (free, non-commercial)
```

TalkingHead and Three.js load from **CDN** via an importmap — no local copy required.

---

## Prerequisites

| Requirement | Details |
|---|---|
| Node.js 18+ | For built-in `fetch` and this Express server |
| Python 3.10+ | For the AG2 backend |
| OpenAI API key | **Must start with `sk-proj-`** — legacy `sk-` keys cause 500 errors |
| Avatar GLB | From [Avaturn](https://avaturn.me) (free, non-commercial). Ready Player Me shut down Jan 31 2026. |
| HeadAudio files | 3 files from [HeadAudio repo](https://github.com/met4citizen/HeadAudio) |

---

## Setup

### 1. Install Node dependencies

```bash
npm install
```

### 2. Add HeadAudio files

From https://github.com/met4citizen/HeadAudio, download and place in `public/libs/`:

| File in HeadAudio repo | Save as |
|---|---|
| `modules/headaudio.mjs` | `public/libs/headaudio.mjs` |
| `modules/headworklet.mjs` | `public/libs/headworklet.mjs` |
| `dist/model-en-mixed.bin` | `public/libs/model-en-mixed.bin` |

### 3. Add your avatar

1. Go to https://avaturn.me
2. Create your character and export the `.glb`
3. Save as `public/assets/avatar.glb`

### 4. Set up the AG2 Python backend

The AG2 backend is a **separate Python project** — not included in this repo.

```bash
git clone https://github.com/ag2ai/realtime-agent-over-webrtc.git
cd realtime-agent-over-webrtc
cp OAI_CONFIG_LIST_sample OAI_CONFIG_LIST
# Edit OAI_CONFIG_LIST — add your sk-proj-... OpenAI API key
pip install -r requirements.txt
uvicorn realtime_over_webrtc.main:app --port 5050
```

Expected: `INFO: Uvicorn running on http://0.0.0.0:5050`

### 5. Start this browser client

```bash
npm start
# open http://localhost:3000
```

To point at a non-default AG2 host:

```bash
AG2_BACKEND_URL=http://your-ag2-host:5050 npm start
```

---

## OBS Integration

1. Open OBS → Add **Browser Source**
2. URL: `http://localhost:3000`
3. Set width/height (e.g. 1280×720)
4. Enable transparency (background is `transparent` in CSS)
5. Route OBS browser audio to a separate track if needed
6. Hide scene → re-show → confirm auto-reconnect triggers

---

## WebRTC Architecture

AG2 uses **WebSocket-based signaling**, not a REST offer/answer API.

```
Browser            Express (3000)         AG2 Python (5050)
  |--WS /session-→ proxy /session ------→ /session WebSocket
  |                                            |
  |      ephemeral key + session config ←------|
  |                                            |
  |--SDP offer → OpenAI (direct P2P)          |
  |← SDP answer ← OpenAI (direct P2P)         |
  |                                            |
  |═══ audio P2P ══ OpenAI Realtime API ═══   |
  |← DataChannel events ←--------------------|
```

On connection failure the client: closes WS + PeerConnection → waits 2 s → reconnects. No page reload.

---

## DataChannel Message Format

```json
{ "type": "subtitle", "payload": "Text to show on screen." }
{ "type": "thinking", "payload": true }
{ "type": "event",    "payload": {} }
```

Malformed JSON is caught and logged — it never throws.

---

## Design Constraints

- Vanilla JavaScript only (no React, no Vue)
- No additional servers beyond the single Express instance
- No modification of TalkingHead or HeadAudio internals
- Must run inside OBS Browser Source
- Must survive multi-hour streams
- Must auto-reconnect without page reload

---

## Production Notes

- Run behind HTTPS in production
- Host the AG2 Python backend behind a reverse proxy (nginx, Caddy)
- Set `AG2_BACKEND_URL` env var to point at your public AG2 host
- OpenAI API key must be `sk-proj-` format

---

## Definition of Done

- Avatar renders on page load
- AG2 WebSocket `/session` connects automatically
- OpenAI WebRTC P2P connection reaches "connected"
- AI voice plays through the `<audio>` element
- TalkingHead mouth lip-syncs via HeadAudio
- DataChannel subtitles display and auto-clear
- Reconnection triggers on failure, no page reload
- Runs 3+ hours without crash or console errors

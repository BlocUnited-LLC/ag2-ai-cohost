# AG2 AI Cohost – Functional Implementation Checklist

This document defines EXACT steps required to make this repository a working real-time AI co-host using:

- AG2 RealtimeAgent (Python/FastAPI backend, WebSocket signaling at `/session`)
- @ag2/client JS library (WebRTC connection)
- TalkingHead (3D avatar, loaded from CDN via importmap)
- HeadAudio (audio-driven real-time lip-sync)
- OBS Browser Source

Docs: https://docs.ag2.ai/latest/docs/user-guide/advanced-concepts/realtime-agent/webrtc/
Backend example: https://github.com/ag2ai/realtime-agent-over-webrtc

Follow this checklist sequentially.
Do NOT skip steps.
Do NOT change architecture.
Do NOT introduce frameworks.

---

# PHASE 1 — File Prerequisites

Goal: Confirm all required static assets exist before starting any server.

[ ] 1. Confirm `public/libs/headaudio.mjs` exists.
        Source: https://github.com/met4citizen/HeadAudio → modules/headaudio.mjs

[ ] 2. Confirm `public/libs/headworklet.mjs` exists.
        Source: https://github.com/met4citizen/HeadAudio → modules/headworklet.mjs

[ ] 3. Confirm `public/libs/model-en-mixed.bin` exists.
        Source: https://github.com/met4citizen/HeadAudio → dist/model-en-mixed.bin

[ ] 4. Confirm `public/assets/avatar.glb` exists.
        Source: https://avaturn.me (free, non-commercial — Avaturn Type-2 is fully compatible)
        NOTE: Ready Player Me shut down January 31 2026. Use Avaturn instead.

[ ] 5. Confirm TalkingHead loads from CDN (no local copy required).
        The importmap in index.html resolves "talkinghead" to:
        https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/talkinghead.mjs

STOP if any file above is missing.

---

# PHASE 2 — AG2 Python Backend Setup

Goal: Run the AG2 RealtimeAgent backend before testing the browser client.

The AG2 backend is a SEPARATE Python project. It is not included in this repo.
It exposes a WebSocket endpoint at /session (NOT POST /offer or POST /answer).
The browser client proxies this WebSocket through the Express server.

[ ] 6. Clone the AG2 example:
        git clone https://github.com/ag2ai/realtime-agent-over-webrtc.git
        cd realtime-agent-over-webrtc

[ ] 7. Create OAI_CONFIG_LIST:
        cp OAI_CONFIG_LIST_sample OAI_CONFIG_LIST

[ ] 8. Add your OpenAI API key to OAI_CONFIG_LIST.
        CRITICAL: Key MUST start with `sk-proj-`.
        Keys beginning with sk- (legacy format) will cause 500 errors from OpenAI.
        See: https://community.openai.com/t/realtime-api-create-sessions-results-in-500-internal-server-error/1060964

[ ] 9. Install Python dependencies:
        pip install -r requirements.txt

[ ] 10. Start the AG2 backend:
         uvicorn realtime_over_webrtc.main:app --port 5050

[ ] 11. Confirm output:
         INFO: Uvicorn running on http://0.0.0.0:5050

[ ] 12. Confirm GET http://localhost:5050/ returns:
         { "message": "WebRTC AG2 Server is running!" }

STOP if AG2 backend does not start cleanly.

---

# PHASE 3 — Browser Client Startup

Goal: Confirm avatar loads before attempting WebRTC.

[ ] 13. Install Node dependencies:
         npm install

[ ] 14. Start Express server:
         npm start
         Default AG2 backend URL: http://localhost:5050
         Override: AG2_BACKEND_URL=http://host:port npm start

[ ] 15. Open http://localhost:3000 in Chrome or Edge.
         (Chrome preferred for OBS testing — strictest autoplay behaviour)

[ ] 16. Confirm avatar.glb loads and 3D model renders.
[ ] 17. Confirm no console errors during avatar load.
[ ] 18. Confirm TalkingHead render loop runs (model should idle/breathe continuously).

STOP if avatar does not render.

---

# PHASE 4 — WebRTC Connection

Goal: Establish WebRTC connection from browser through AG2 to OpenAI.

Architecture note:
  Browser ↔ WebSocket /session ↔ Express proxy ↔ AG2 Python backend
  AG2 backend fetches ephemeral key from OpenAI and returns session config.
  Browser then connects peer-to-peer directly to OpenAI Realtime API.
  Audio travels Browser ↔ OpenAI P2P. AG2 backend is signaling relay only.

[ ] 19. Confirm server.js proxies WebSocket /session to AG2 backend.
[ ] 20. Confirm webrtc.js opens a WebSocket to /session on page load.
[ ] 21. Confirm ephemeral key and session config arrive from AG2 backend.
[ ] 22. Confirm RTCPeerConnection is created with correct ICE config.
[ ] 23. Confirm SDP offer is sent to OpenAI with ephemeral key.
[ ] 24. Confirm SDP answer is received from OpenAI.
[ ] 25. Confirm ontrack fires (remote audio track arrives).
[ ] 26. Confirm connection state reaches "connected" in browser console.
[ ] 27. Confirm no unhandled console errors during handshake.

STOP if connection state does not reach "connected".

---

# PHASE 5 — Audio and Lip Sync

Goal: Pipe remote audio into the avatar for live lip sync.

[ ] 28. Confirm remote audio track is attached to <audio id="ai-audio"> srcObject.
[ ] 29. Confirm AI voice plays audibly through the browser.
[ ] 30. Confirm HeadAudio worklet is registered and model-en-mixed.bin is loaded.
[ ] 31. Confirm HeadAudio receives the MediaStream from the remote track.
[ ] 32. Confirm TalkingHead mouth blend-shapes animate while AI speaks.
[ ] 33. Confirm lip sync stops when AI is silent.
[ ] 34. Confirm interruption works (AI stops when user speaks into mic).

STOP if lip sync does not animate.

---

# PHASE 6 — DataChannel Integration

Goal: Handle metadata events from AG2.

[ ] 35. Confirm ondatachannel fires after connection is established.
[ ] 36. Confirm incoming JSON is parsed safely (try/catch).
[ ] 37. Confirm switch(msg.type) handles:
         "subtitle" → shows #subtitle-overlay text, auto-clears after 6 s
         "thinking" → toggles #thinking-indicator visibility
         default    → console.debug only, no throw
[ ] 38. Confirm malformed JSON is logged, not thrown.
[ ] 39. Confirm no unhandled exceptions at any point.

STOP if any unhandled exception occurs.

---

# PHASE 7 — Reconnection Logic

Goal: Survive network interruptions without a page reload.

[ ] 40. Confirm connectionstatechange covers: "failed", "disconnected", "closed".
[ ] 41. Confirm iceconnectionstatechange covers the same states.
[ ] 42. On any failure state:
         - WebSocket is closed cleanly
         - PeerConnection is destroyed
         - 2 second wait
         - initWebRTC() is called automatically
[ ] 43. Confirm HeadAudio reattaches to the new remote stream after reconnect.
[ ] 44. Confirm UI (subtitles, thinking indicator) resets cleanly on reconnect.
[ ] 45. Confirm reconnection happens with NO page reload required.

STOP if page must be refreshed manually.

---

# PHASE 8 — OBS Validation

Goal: Confirm the full system works as an OBS Browser Source.

[ ] 46. In OBS: Add Browser Source → URL: http://localhost:3000
[ ] 47. Set width/height (e.g. 1280×720).
[ ] 48. Confirm background is transparent.
[ ] 49. Confirm AI audio is audible through OBS.
[ ] 50. Hide scene → re-show scene → confirm reconnect triggers automatically.
[ ] 51. Run for 30 minutes → confirm no crash, no memory growth.
[ ] 52. Run for 3 hours → confirm full stability.

---

# FINAL ACCEPTANCE CHECKLIST

System is complete when ALL of these pass:

[ ] Avatar renders on page load.
[ ] AG2 WebSocket /session connects automatically.
[ ] OpenAI WebRTC P2P connection reaches "connected".
[ ] AI voice plays through the browser <audio> element.
[ ] TalkingHead mouth lip-syncs via HeadAudio.
[ ] DataChannel subtitle events display and auto-clear.
[ ] Thinking indicator toggles correctly.
[ ] Reconnect triggers on failure — no page reload.
[ ] Runs 3 hours without crash.
[ ] Zero unhandled console errors.

If any box fails, system is NOT complete.

---

# STRICT RULES

- No React.
- No additional servers (one Express + one AG2 Python backend — that is two total).
- No refactoring folder structure.
- No UI frameworks.
- No changing TalkingHead or HeadAudio internals.
- No polling.
- No blocking calls.

Everything must remain vanilla JS on the browser side.

---

# Definition of Done

A stable AI co-host that:
- Renders a 3D avatar
- Talks with real-time lip sync
- Reconnects automatically on failure
- Runs in OBS
- Handles subtitle and thinking metadata
- Survives 3-hour streams without crash

Nothing else.
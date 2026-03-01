# AG2 AI Cohost – Functional Implementation Checklist

This document defines EXACT steps required to turn this repository into a working real-time AI co-host using:

- AG2 RealtimeAgent (WebRTC adapter)
- TalkingHead avatar
- OBS Browser Source

Follow this checklist sequentially.
Do NOT skip steps.
Do NOT change architecture.
Do NOT introduce frameworks.

---

# PHASE 1 — TalkingHead Standalone Validation

Goal: Confirm avatar loads and renders before adding WebRTC.

[ ] 1. Confirm public/assets/avatar.glb exists.
[ ] 2. Confirm public/libs/talkinghead.js exists.
[ ] 3. In avatar.js, ensure:
      - TalkingHead initializes successfully.
      - showAvatar() loads the GLB file.
[ ] 4. Start server: `node server.js`
[ ] 5. Open http://localhost:3000
[ ] 6. Confirm avatar renders with no console errors.
[ ] 7. Confirm render loop runs continuously.

STOP if avatar does not render correctly.

---

# PHASE 2 — WebRTC Signaling Implementation

Goal: Establish WebRTC connection to AG2 backend.

Assume AG2 backend provides:

POST /offer
POST /answer

[ ] 8. In webrtc.js, implement async function `createConnection()`
[ ] 9. Fetch SDP offer from backend:
        fetch('/offer')
[ ] 10. Create RTCPeerConnection instance.
[ ] 11. Set remote description using received offer.
[ ] 12. Create answer via createAnswer().
[ ] 13. Set local description.
[ ] 14. POST answer back to backend.
[ ] 15. Add ICE candidate handler.
[ ] 16. Log connection state changes.
[ ] 17. Confirm no console errors.

STOP if connection state does not reach "connected".

---

# PHASE 3 — Remote Audio Integration

Goal: Pipe AG2 audio into avatar.

[ ] 18. Implement peerConnection.ontrack handler.
[ ] 19. When audio track arrives:
        - Attach to <audio id="ai-audio">
        - Call attachAudioToAvatar(audioElement)
[ ] 20. Confirm AI audio plays in browser.
[ ] 21. Confirm TalkingHead mouth animates from audio.
[ ] 22. Confirm interruption works (AI stops when user speaks).

STOP if lip sync does not work.

---

# PHASE 4 — DataChannel Integration

Goal: Handle metadata events.

[ ] 23. Implement peerConnection.ondatachannel.
[ ] 24. Parse incoming JSON safely.
[ ] 25. Implement switch(msg.type):
        - "subtitle"
        - "thinking"
        - default (console.log)
[ ] 26. Create subtitle overlay div in index.html.
[ ] 27. Render subtitle text live.
[ ] 28. Auto-clear subtitle after 5 seconds.
[ ] 29. Handle malformed JSON gracefully.

STOP if any unhandled exception occurs.

---

# PHASE 5 — Reconnection Logic

Goal: Survive network interruptions.

[ ] 30. Listen to connectionStatechange.
[ ] 31. If state is:
        - "failed"
        - "disconnected"
        - "closed"
      then:
        - Close peerConnection
        - Wait 2 seconds
        - Re-run createConnection()
[ ] 32. Ensure avatar audio reattaches after reconnect.
[ ] 33. Confirm reconnection works without page reload.

STOP if page must be refreshed manually.

---

# PHASE 6 — OBS Validation

Goal: Ensure browser source compatibility.

[ ] 34. In OBS:
        Add Browser Source:
        URL: http://localhost:3000
[ ] 35. Set width/height.
[ ] 36. Confirm transparency works.
[ ] 37. Confirm audio routes into OBS.
[ ] 38. Hide and re-show scene.
[ ] 39. Confirm reconnection works automatically.
[ ] 40. Let run for 30 minutes.
[ ] 41. Confirm no memory leaks or crashes.

---

# FINAL ACCEPTANCE CHECKLIST

System is complete when:

[ ] Avatar loads on page load.
[ ] AG2 connects automatically.
[ ] AI speaks through avatar.
[ ] Lip sync works.
[ ] DataChannel subtitles render.
[ ] Reconnect works automatically.
[ ] Runs 3 hours without failure.
[ ] No unhandled console errors.

If any box fails, system is NOT complete.

---

# STRICT RULES

- No React.
- No additional servers.
- No refactoring folder structure.
- No UI frameworks.
- No changing TalkingHead internals.
- No polling.
- No blocking calls.

Everything must remain vanilla JS.

---

# Definition of Done

A stable AI co-host that:
- Talks
- Lip syncs
- Reconnects
- Runs in OBS
- Handles metadata

Nothing else.
# 🎙️ AI Cohost (AG2 + TalkingHead + OBS)

A real-time AI podcast co-host built with:

- AG2 RealtimeAgent (WebRTC)
- TalkingHead (Three.js avatar)
- OBS Browser Source

This project renders a live 3D avatar in the browser, streams real-time AI voice from AG2 via WebRTC, performs lip sync, and integrates directly into OBS.

No Unity.  
No Unreal.  
No frontend frameworks.

---

# 🧠 What This Project Does

This repository implements the browser-side client for a real-time AI co-host system.

It:

- Connects to an AG2 RealtimeAgent via WebRTC
- Receives AI audio stream
- Feeds audio into TalkingHead for lip sync
- Listens to DataChannel metadata
- Displays subtitles in real-time
- Automatically reconnects on network failure
- Runs inside OBS as a Browser Source

This repo does NOT contain the AG2 backend.

---

# 🏗 Architecture Overview

Your Mic  
→ AG2 RealtimeAgent (WebRTC)  
→ WebRTC Connection  
  • Remote Audio Track  
  • DataChannel (JSON events)  
→ Browser Client (this repo)  
  • Audio Playback  
  • Lip Sync via TalkingHead  
  • Subtitle Overlay  
→ OBS Browser Source  

---

# 📂 Project Structure

ai-cohost/
│
├── server.js              Local dev server  
├── ag2-cohost.md          Implementation checklist  
│
├── public/
│   ├── index.html         OBS Browser entry  
│   ├── css/styles.css  
│   ├── js/
│   │   ├── webrtc.js      WebRTC + signaling logic  
│   │   ├── avatar.js      TalkingHead integration  
│   │   └── main.js        Bootstrap  
│   │
│   ├── libs/
│   │   └── talkinghead.js  
│   │
│   └── assets/
│       └── avatar.glb  

---

# 🚀 Setup Instructions

## 1. Install Dependencies

npm install

---

## 2. Add TalkingHead Library

Download from:

https://github.com/met4citizen/TalkingHead

Place the built JS file into:

public/libs/talkinghead.js

---

## 3. Add Avatar Model

Place your GLB or VRM model into:

public/assets/avatar.glb

Update avatar.js if the filename differs.

---

## 4. Configure AG2 Backend

This client expects AG2 backend signaling endpoints:

POST /offer  
POST /answer  

Modify public/js/webrtc.js to point to your backend URL.

Example:

fetch('https://your-ag2-server/offer')

---

## 5. Start Local Server

node server.js

Open:

http://localhost:3000

If working correctly:

- Avatar loads
- WebRTC connects
- AI voice streams
- Lip sync activates

---

# 🎥 OBS Integration

1. Open OBS  
2. Add Browser Source  
3. Set URL to:

http://localhost:3000

4. Set width and height  
5. Enable transparency  
6. Route browser audio to separate track if desired  

Test:

- Hide scene  
- Re-show scene  
- Confirm auto-reconnect works  

---

# 🔌 WebRTC Behavior

The client:

1. Fetches SDP offer from AG2 backend  
2. Creates RTCPeerConnection  
3. Sends SDP answer  
4. Receives:
   - Remote audio track
   - DataChannel events  

On connection failure:

- Closes PeerConnection  
- Waits 2 seconds  
- Reconnects automatically  

No page refresh required.

---

# 📡 DataChannel Messages

Expected JSON format:

{
  "type": "subtitle",
  "payload": "That refactor is cursed."
}

Supported types:

- subtitle
- thinking
- event

Malformed JSON is ignored safely.

---

# 🧪 Development Checklist

See:

ag2-cohost.md

This contains the strict step-by-step implementation guide.

---

# ⚙️ Design Constraints

- Vanilla JavaScript only
- No React or Vue
- No external UI frameworks
- No modification of TalkingHead internals
- Must run inside OBS Browser Source
- Must survive multi-hour streams
- Must auto-reconnect

---

# 🔒 Production Considerations

For real deployment:

- Run behind HTTPS
- Host AG2 backend publicly or via reverse proxy
- Add logging for connection failures
- Consider heartbeat mechanism
- Add session authentication if needed

---

# 📌 What This Project Is Not

- Not a VTuber framework
- Not a Unity integration
- Not a call center bot
- Not a telephony system
- Not a demo toy

This is a real-time AI co-host client.

---

# ✅ Definition of Done

System is complete when:

- Avatar loads automatically
- AG2 connects automatically
- AI voice plays
- Lip sync works
- Subtitles render
- Reconnection works
- Runs 3+ hours without crash
- No console errors
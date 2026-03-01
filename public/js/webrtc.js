'use strict';

(function () {

  // ---------------------------------------------------------------------------
  // Configuration
  // Override window.COHOST_CONFIG.signalingBaseUrl before scripts load to point
  // the browser at a different signaling host (e.g. for OBS scene with remote
  // Express server).  Defaults to same origin (Express proxies to AG2 backend).
  // ---------------------------------------------------------------------------
  function signalingBase() {
    return (window.COHOST_CONFIG && window.COHOST_CONFIG.signalingBaseUrl) || '';
  }

  // ---------------------------------------------------------------------------
  // Module state — single private scope, no globals
  // ---------------------------------------------------------------------------
  var pc              = null;
  var reconnectTimer  = null;
  var shuttingDown    = false;
  var subtitleTimer   = null;

  // ---------------------------------------------------------------------------
  // Subtitle overlay
  // ---------------------------------------------------------------------------
  function showSubtitle(text) {
    var el = document.getElementById('subtitle-overlay');
    if (!el) return;
    el.textContent = (typeof text === 'string') ? text : JSON.stringify(text);
    el.classList.add('visible');
    clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(function () {
      el.classList.remove('visible');
    }, 6000);
  }

  function clearSubtitle() {
    clearTimeout(subtitleTimer);
    var el = document.getElementById('subtitle-overlay');
    if (el) el.classList.remove('visible');
  }

  // ---------------------------------------------------------------------------
  // Thinking indicator
  // ---------------------------------------------------------------------------
  function setThinking(active) {
    var el = document.getElementById('thinking-indicator');
    if (!el) return;
    if (active) {
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  }

  // ---------------------------------------------------------------------------
  // DataChannel message dispatcher
  // ---------------------------------------------------------------------------
  function handleDataMessage(raw) {
    var msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      console.warn('[WebRTC] Malformed DataChannel message (ignored):', raw);
      return;
    }

    console.debug('[WebRTC] DataChannel message:', msg);

    switch (msg.type) {
      case 'subtitle':
        showSubtitle(msg.payload);
        break;
      case 'thinking':
        setThinking(msg.payload !== false);
        break;
      case 'event':
        console.debug('[WebRTC] Event payload:', msg.payload);
        break;
      default:
        console.debug('[WebRTC] Unknown message type:', msg.type);
    }
  }

  // ---------------------------------------------------------------------------
  // Destroy existing PeerConnection cleanly
  // ---------------------------------------------------------------------------
  function destroyConnection() {
    if (!pc) return;
    pc.oniceconnectionstatechange = null;
    pc.onconnectionstatechange    = null;
    pc.onicegatheringstatechange  = null;
    pc.ontrack                    = null;
    pc.ondatachannel              = null;
    try { pc.close(); } catch (_) {}
    pc = null;
    console.info('[WebRTC] PeerConnection destroyed.');
  }

  // ---------------------------------------------------------------------------
  // Schedule reconnection attempt (2 s delay, no page reload)
  // ---------------------------------------------------------------------------
  function scheduleReconnect() {
    if (shuttingDown) return;
    clearTimeout(reconnectTimer);
    console.info('[WebRTC] Scheduling reconnect in 2 s...');
    setThinking(false);
    reconnectTimer = setTimeout(function () {
      if (!shuttingDown) initWebRTC();
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // Wait until ICE gathering is complete before sending the answer.
  // Resolves immediately if already complete; safety-exits after 8 s.
  // ---------------------------------------------------------------------------
  function waitForIceGathering(peerConn) {
    return new Promise(function (resolve) {
      if (peerConn.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      var timeout = setTimeout(function () {
        peerConn.removeEventListener('icegatheringstatechange', onState);
        console.warn('[WebRTC] ICE gathering timed out — sending partial candidates.');
        resolve();
      }, 8000);

      function onState() {
        if (peerConn.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          peerConn.removeEventListener('icegatheringstatechange', onState);
          resolve();
        }
      }
      peerConn.addEventListener('icegatheringstatechange', onState);
    });
  }

  // ---------------------------------------------------------------------------
  // Main: full signaling + connection setup
  // AG2 is the *offerer*; browser is the *answerer*.
  //
  // Flow:
  //   1. POST /offer          → receive AG2's SDP offer
  //   2. setRemoteDescription (offer)
  //   3. createAnswer
  //   4. setLocalDescription  (answer)
  //   5. wait for ICE gathering complete
  //   6. POST /answer         → send our SDP answer with gathered candidates
  // ---------------------------------------------------------------------------
  async function initWebRTC() {
    destroyConnection();

    var base = signalingBase();

    // ── Step 1: Fetch SDP offer from AG2 ──────────────────────────────────────
    var offerSdp;
    try {
      var offerRes = await fetch(base + '/offer', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    '{}'
      });
      if (!offerRes.ok) throw new Error('HTTP ' + offerRes.status);
      var offerJson = await offerRes.json();
      // Accept both { sdp: "..." } and bare SDP string
      offerSdp = (offerJson && offerJson.sdp) ? offerJson.sdp : offerJson;
    } catch (err) {
      console.error('[WebRTC] Failed to fetch offer:', err);
      scheduleReconnect();
      return;
    }

    // ── Step 2: Create RTCPeerConnection ──────────────────────────────────────
    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // ── Step 3: Connection health monitoring ──────────────────────────────────
    pc.oniceconnectionstatechange = function () {
      console.debug('[WebRTC] ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'disconnected' ||
          pc.iceConnectionState === 'closed') {
        destroyConnection();
        scheduleReconnect();
      }
    };

    pc.onconnectionstatechange = function () {
      console.debug('[WebRTC] Peer connection state:', pc.connectionState);
      if (pc.connectionState === 'failed' ||
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'closed') {
        destroyConnection();
        scheduleReconnect();
      }
    };

    // ── Step 4: Incoming remote audio track ───────────────────────────────────
    pc.ontrack = function (event) {
      if (event.track.kind !== 'audio') return;
      var audioEl = document.getElementById('ai-audio');
      if (!audioEl) return;

      // Replace srcObject on renegotiation without creating a new element
      audioEl.srcObject = event.streams[0];
      audioEl.play().catch(function (e) {
        console.warn('[WebRTC] Audio play() suppressed (autoplay policy):', e.message);
      });

      if (typeof window.attachAudioToAvatar === 'function') {
        window.attachAudioToAvatar(audioEl);
      }
    };

    // ── Step 5: Incoming DataChannel ──────────────────────────────────────────
    pc.ondatachannel = function (event) {
      var ch = event.channel;
      ch.onmessage = function (e) { handleDataMessage(e.data); };
      ch.onerror   = function (e) { console.warn('[WebRTC] DataChannel error:', e); };
      ch.onclose   = function ()  { console.info('[WebRTC] DataChannel closed.'); };
    };

    // ── Step 6: Set AG2's offer as remote description ─────────────────────────
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    } catch (err) {
      console.error('[WebRTC] setRemoteDescription failed:', err);
      destroyConnection();
      scheduleReconnect();
      return;
    }

    // ── Step 7: Create and set local answer ───────────────────────────────────
    var answer;
    try {
      answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
    } catch (err) {
      console.error('[WebRTC] createAnswer/setLocalDescription failed:', err);
      destroyConnection();
      scheduleReconnect();
      return;
    }

    // ── Step 8: Wait for full ICE gathering ───────────────────────────────────
    await waitForIceGathering(pc);

    // ── Step 9: POST completed answer (with embedded ICE candidates) ──────────
    try {
      var answerRes = await fetch(base + '/answer', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type: pc.localDescription.type,
          sdp:  pc.localDescription.sdp
        })
      });
      if (!answerRes.ok) throw new Error('HTTP ' + answerRes.status);
      console.info('[WebRTC] Signaling complete — WebRTC session established.');
    } catch (err) {
      console.error('[WebRTC] Failed to POST answer:', err);
      destroyConnection();
      scheduleReconnect();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  window.initWebRTC = initWebRTC;

  // Call to permanently shut down (e.g. when tab is hidden for a long time)
  window.destroyWebRTC = function () {
    shuttingDown = true;
    clearTimeout(reconnectTimer);
    destroyConnection();
    clearSubtitle();
    setThinking(false);
  };

}());

'use strict';

(function () {

  // ── Configuration ──────────────────────────────────────────────────────────
  // Set window.COHOST_CONFIG.signalingBaseUrl before scripts load to point at
  // a remote Express server (e.g. when running OBS on a different machine).
  // Defaults to same origin so Express proxies /session to AG2.
  function signalingUrl() {
    var base = (window.COHOST_CONFIG && window.COHOST_CONFIG.signalingBaseUrl) || '';
    if (base) return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/session';
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/session';
  }

  // ── Module state ────────────────────────────────────────────────────────────
  var ws             = null;   // WebSocket to /session (AG2 signaling)
  var pc             = null;   // RTCPeerConnection to OpenAI
  var reconnectTimer = null;
  var shuttingDown   = false;
  var subtitleTimer  = null;

  // ── Subtitle overlay ────────────────────────────────────────────────────────
  function showSubtitle(text) {
    var el = document.getElementById('subtitle-overlay');
    if (!el) return;
    el.textContent = (typeof text === 'string') ? text : JSON.stringify(text);
    el.classList.add('visible');
    clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(function () { el.classList.remove('visible'); }, 6000);
  }

  function clearSubtitle() {
    clearTimeout(subtitleTimer);
    var el = document.getElementById('subtitle-overlay');
    if (el) el.classList.remove('visible');
  }

  // ── Thinking indicator ──────────────────────────────────────────────────────
  function setThinking(active) {
    var el = document.getElementById('thinking-indicator');
    if (!el) return;
    el.classList.toggle('visible', !!active);
  }

  // ── DataChannel messages ─────────────────────────────────────────────────────
  function handleDataMessage(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (_) {
      console.warn('[WebRTC] Malformed DataChannel message (ignored):', raw);
      return;
    }
    console.debug('[WebRTC] DataChannel message:', msg);
    switch (msg.type) {
      case 'subtitle': showSubtitle(msg.payload);              break;
      case 'thinking': setThinking(msg.payload !== false);     break;
      case 'event':    console.debug('[WebRTC] Event:', msg.payload); break;
      default:         console.debug('[WebRTC] Unknown type:', msg.type);
    }
  }

  function attachDataChannel(ch) {
    ch.onmessage = function (e) { handleDataMessage(e.data); };
    ch.onerror   = function (e) { console.warn('[WebRTC] DataChannel error:', e); };
    ch.onclose   = function ()  { console.info('[WebRTC] DataChannel closed.'); };
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  function destroyConnection() {
    if (ws) { try { ws.close(); } catch (_) {} ws = null; }
    if (pc) {
      pc.ontrack = pc.ondatachannel = pc.onconnectionstatechange = pc.oniceconnectionstatechange = null;
      try { pc.close(); } catch (_) {}
      pc = null;
    }
    console.info('[WebRTC] Connection destroyed.');
  }

  // ── Reconnect ────────────────────────────────────────────────────────────────
  function scheduleReconnect() {
    if (shuttingDown) return;
    clearTimeout(reconnectTimer);
    console.info('[WebRTC] Scheduling reconnect in 2 s...');
    setThinking(false);
    reconnectTimer = setTimeout(function () { if (!shuttingDown) initWebRTC(); }, 2000);
  }

  // ── Main connection flow ─────────────────────────────────────────────────────
  // AG2 WebRTC architecture:
  //   1. Browser opens WebSocket to /session (Express proxies to AG2 Python on 5050)
  //   2. AG2 responds with OpenAI session config including an ephemeral key
  //   3. Browser does WebRTC SDP exchange DIRECTLY with OpenAI using that key
  //   4. Audio is P2P: Browser <-> OpenAI Realtime API
  //
  // Docs: https://docs.ag2.ai/latest/docs/user-guide/advanced-concepts/realtime-agent/webrtc/
  async function initWebRTC() {
    destroyConnection();
    var url = signalingUrl();
    console.info('[WebRTC] Connecting to AG2 session at', url);

    try {
      // ── Step 1: Open WebSocket ──────────────────────────────────────────────
      ws = new WebSocket(url);
      await new Promise(function (resolve, reject) {
        ws.onopen  = resolve;
        ws.onerror = function () { reject(new Error('WebSocket connection failed')); };
        setTimeout(function () { reject(new Error('WebSocket open timed out')); }, 10000);
      });

      // ── Step 2: Wait for ephemeral key from AG2 ─────────────────────────────
      var sessionData = await new Promise(function (resolve, reject) {
        ws.onmessage = function (e) {
          try {
            var msg = JSON.parse(e.data);
            // AG2 sends either type=session.created or wraps it in {type:"session",...}
            if (msg.client_secret || (msg.session && msg.session.client_secret)) {
              resolve(msg.session || msg);
            }
          } catch (_) {}
        };
        ws.onerror = function () { reject(new Error('WebSocket error waiting for session')); };
        ws.onclose = function () { reject(new Error('WebSocket closed before session')); };
        setTimeout(function () { reject(new Error('Session data timed out')); }, 15000);
      });

      var ephemeralKey = sessionData.client_secret && sessionData.client_secret.value;
      if (!ephemeralKey) throw new Error('No ephemeral key in session: ' + JSON.stringify(sessionData));
      var model = (sessionData.model || 'gpt-4o-mini-realtime-preview');
      console.info('[WebRTC] Got ephemeral key, model:', model);

      // ── Step 3: Create PeerConnection ───────────────────────────────────────
      pc = new RTCPeerConnection();
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = function (event) {
        if (event.track.kind !== 'audio') return;
        var audioEl = document.getElementById('ai-audio');
        if (!audioEl) return;
        audioEl.srcObject = event.streams[0];
        audioEl.play().catch(function (e) {
          console.warn('[WebRTC] Audio autoplay blocked:', e.message);
        });
        if (typeof window.setupHeadAudio === 'function') window.setupHeadAudio(event.streams[0]);
      };

      pc.ondatachannel = function (ev) { attachDataChannel(ev.channel); };

      pc.onconnectionstatechange = function () {
        console.debug('[WebRTC] Connection state:', pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          destroyConnection(); scheduleReconnect();
        }
      };

      pc.oniceconnectionstatechange = function () {
        console.debug('[WebRTC] ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          destroyConnection(); scheduleReconnect();
        }
      };

      // ── Step 4: SDP offer → OpenAI ──────────────────────────────────────────
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      var sdpResponse = await fetch(
        'https://api.openai.com/v1/realtime?model=' + encodeURIComponent(model),
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + ephemeralKey, 'Content-Type': 'application/sdp' },
          body: offer.sdp
        }
      );
      if (!sdpResponse.ok) throw new Error('OpenAI SDP exchange failed: HTTP ' + sdpResponse.status);

      var answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      console.info('[WebRTC] WebRTC P2P connection to OpenAI established.');

    } catch (err) {
      console.error('[WebRTC] Connection failed:', err);
      destroyConnection();
      scheduleReconnect();
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  window.initWebRTC   = initWebRTC;
  window.destroyWebRTC = function () {
    shuttingDown = true;
    clearTimeout(reconnectTimer);
    destroyConnection();
    clearSubtitle();
    setThinking(false);
  };

}());

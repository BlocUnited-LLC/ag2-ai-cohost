'use strict';

(function () {

  // ── Configuration ───────────────────────────────────────────────────────────
  // Set window.COHOST_CONFIG.signalingBaseUrl to override the signaling host.
  function signalingUrl() {
    var base = (window.COHOST_CONFIG && window.COHOST_CONFIG.signalingBaseUrl) || '';
    if (base) return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/session';
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/session';
  }

  // ── Module state ─────────────────────────────────────────────────────────────
  var agWebRTC       = null;
  var reconnectTimer = null;
  var shuttingDown   = false;
  var subtitleTimer  = null;

  // ── Subtitle overlay ─────────────────────────────────────────────────────────
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

  // ── Thinking indicator ───────────────────────────────────────────────────────
  function setThinking(active) {
    var el = document.getElementById('thinking-indicator');
    if (!el) return;
    el.classList.toggle('visible', !!active);
  }

  // ── DataChannel messages ──────────────────────────────────────────────────────
  function handleDataMessage(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    switch (msg.type) {
      case 'subtitle': showSubtitle(msg.payload); break;
      case 'thinking': setThinking(msg.payload !== false); break;
    }
  }

  // ── Destroy ──────────────────────────────────────────────────────────────────
  function destroyConnection() {
    if (agWebRTC) {
      try {
        if (typeof agWebRTC.close       === 'function') agWebRTC.close();
        if (typeof agWebRTC.disconnect  === 'function') agWebRTC.disconnect();
      } catch (_) {}
      agWebRTC = null;
    }
    console.info('[WebRTC] Connection destroyed.');
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────────
  function scheduleReconnect() {
    if (shuttingDown) return;
    clearTimeout(reconnectTimer);
    setThinking(false);
    console.info('[WebRTC] Reconnecting in 2 s...');
    reconnectTimer = setTimeout(function () { if (!shuttingDown) initWebRTC(); }, 2000);
  }

  // ── Wire audio into HeadAudio for lip-sync ────────────────────────────────────
  // ag2client manages mic + playback internally; we just tap into the incoming
  // audio track for TalkingHead mouth animation — no separate <audio> element needed.
  function hookAudio(pc) {
    if (!pc) return;
    pc.addEventListener('track', function (event) {
      if (!event.track || event.track.kind !== 'audio') return;
      var stream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
      // Also drive the visible <audio> element so volume meters work in OBS
      var audioEl = document.getElementById('ai-audio');
      if (audioEl && !audioEl.srcObject) {
        audioEl.srcObject = stream;
        audioEl.play().catch(function () {});
      }
      if (typeof window.setupHeadAudio === 'function') window.setupHeadAudio(stream);
      console.info('[WebRTC] Remote audio track received — lip-sync active.');
    });

    // Hook DataChannel if AG2 sends one
    pc.addEventListener('datachannel', function (event) {
      var ch = event.channel;
      ch.onmessage = function (e) { handleDataMessage(e.data); };
    });
  }

  // ── Main ──────────────────────────────────────────────────────────────────────
  // ag2client.WebRTC handles the full signaling flow:
  //   WS /session → AG2 Python → OpenAI ephemeral key → SDP P2P
  // Mic access and audio playback are handled inside ag2client.
  async function initWebRTC() {
    destroyConnection();

    if (typeof ag2client === 'undefined') {
      console.error('[WebRTC] ag2client not loaded. Retrying...');
      scheduleReconnect();
      return;
    }

    var url = signalingUrl();
    console.info('[WebRTC] Connecting to AG2 session at', url);

    try {
      // ── Intercept RTCPeerConnection before ag2client creates one ──────────────
      // ag2client doesn't expose its internal PC via a public property, so we
      // monkey-patch the constructor to capture it the moment it's instantiated.
      var interceptedPc = null;
      var OrigRTCPC = window.RTCPeerConnection;
      window.RTCPeerConnection = function (config, constraints) {
        var pc = new OrigRTCPC(config, constraints);
        interceptedPc = pc;
        console.info('[WebRTC] RTCPeerConnection intercepted for lip-sync.');
        // Hook immediately so we never miss the 'track' event
        hookAudio(pc);
        return pc;
      };
      // Copy static members so ag2client's instanceof checks still pass
      Object.setPrototypeOf(window.RTCPeerConnection, OrigRTCPC);
      window.RTCPeerConnection.prototype = OrigRTCPC.prototype;

      agWebRTC = new ag2client.WebRTC(url);

      // Disconnect handler — triggers reconnect
      agWebRTC.onDisconnect = function () {
        console.warn('[WebRTC] ag2client disconnected.');
        destroyConnection();
        scheduleReconnect();
      };

      // Connect — this: opens WS, exchanges SDP with OpenAI via AG2, enables mic
      await agWebRTC.connect();

      // Restore the real RTCPeerConnection constructor
      window.RTCPeerConnection = OrigRTCPC;

      // Fallback: if intercept fired after connect, check receivers now
      if (interceptedPc) {
        interceptedPc.getReceivers().forEach(function (receiver) {
          if (receiver.track && receiver.track.kind === 'audio') {
            var stream = new MediaStream([receiver.track]);
            var audioEl = document.getElementById('ai-audio');
            if (audioEl && !audioEl.srcObject) {
              audioEl.srcObject = stream;
              audioEl.play().catch(function () {});
            }
            if (typeof window.setupHeadAudio === 'function') window.setupHeadAudio(stream);
            console.info('[WebRTC] Audio receiver found post-connect — lip-sync active.');
          }
        });
      }

      console.info('[WebRTC] Connected. You can now speak to the AI co-host.');
    } catch (err) {
      console.error('[WebRTC] Connection failed:', err);
      destroyConnection();
      scheduleReconnect();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.initWebRTC   = initWebRTC;
  window.destroyWebRTC = function () {
    shuttingDown = true;
    clearTimeout(reconnectTimer);
    destroyConnection();
    clearSubtitle();
    setThinking(false);
  };

}());

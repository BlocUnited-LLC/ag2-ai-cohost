'use strict';

// Browser audio bridge for AG2 LiveAgent. The legacy filename is retained so
// existing deployments do not need to change cached asset paths.
(function () {
  var TARGET_SAMPLE_RATE = 24000;
  var socket = null;
  var reconnectTimer = null;
  var shuttingDown = false;
  var subtitleTimer = null;
  var ready = false;

  var audioContext = null;
  var micStream = null;
  var micSource = null;
  var micProcessor = null;
  var outputDestination = null;
  var nextPlaybackTime = 0;
  var micMuted = false;

  function sessionUrl() {
    var base = (window.COHOST_CONFIG && window.COHOST_CONFIG.signalingBaseUrl) || '';
    if (base) return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/session';
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/session';
  }

  function showSubtitle(text) {
    var el = document.getElementById('subtitle-overlay');
    if (!el) return;
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(function () { el.classList.remove('visible'); }, 6000);
  }

  function setThinking(active) {
    var el = document.getElementById('thinking-indicator');
    if (el) el.classList.toggle('visible', !!active);
  }

  function setMicMuted(muted) {
    micMuted = !!muted;
    var el = document.getElementById('mic-mute-indicator');
    if (el) el.classList.toggle('visible', micMuted);
    console.info('[LiveAudio] Mic ' + (micMuted ? 'MUTED' : 'UNMUTED'));
  }

  function toggleMic() {
    setMicMuted(!micMuted);
  }

  document.addEventListener('keydown', function (event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    if (event.key === 'm' || event.key === 'M') toggleMic();
  });

  function downsampleToPcm16(samples, sourceRate) {
    var ratio = sourceRate / TARGET_SAMPLE_RATE;
    var outputLength = Math.max(1, Math.floor(samples.length / ratio));
    var buffer = new ArrayBuffer(outputLength * 2);
    var view = new DataView(buffer);

    for (var outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      var start = Math.floor(outputIndex * ratio);
      var end = Math.min(samples.length, Math.floor((outputIndex + 1) * ratio));
      var total = 0;
      for (var inputIndex = start; inputIndex < end; inputIndex += 1) total += samples[inputIndex];
      var sample = total / Math.max(1, end - start);
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(outputIndex * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return buffer;
  }

  async function ensureAudio() {
    if (audioContext) return;

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
    outputDestination = audioContext.createMediaStreamDestination();

    var audioEl = document.getElementById('ai-audio');
    if (audioEl) {
      audioEl.srcObject = outputDestination.stream;
      audioEl.play().catch(function () {});
    }
    if (typeof window.setupHeadAudio === 'function') {
      window.setupHeadAudio(outputDestination.stream);
    }

    micSource = audioContext.createMediaStreamSource(micStream);
    micProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    micProcessor.onaudioprocess = function (event) {
      if (!ready || micMuted || !socket || socket.readyState !== WebSocket.OPEN) return;
      var pcm = downsampleToPcm16(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
      socket.send(pcm);
    };
    micSource.connect(micProcessor);
    micProcessor.connect(audioContext.destination);

    console.info('[LiveAudio] Microphone and PCM playback bridge ready.');
  }

  async function resumeLiveAudio() {
    try {
      await ensureAudio();
      if (audioContext.state === 'suspended') await audioContext.resume();
      var audioEl = document.getElementById('ai-audio');
      if (audioEl) await audioEl.play().catch(function () {});
    } catch (err) {
      console.error('[LiveAudio] Could not start browser audio:', err);
    }
  }

  function playPcm(arrayBuffer) {
    if (!audioContext || !outputDestination || !arrayBuffer.byteLength) return;
    var pcm = new Int16Array(arrayBuffer);
    var audioBuffer = audioContext.createBuffer(1, pcm.length, TARGET_SAMPLE_RATE);
    var channel = audioBuffer.getChannelData(0);
    for (var i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 32768;

    var source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputDestination);
    var startAt = Math.max(audioContext.currentTime + 0.01, nextPlaybackTime);
    source.start(startAt);
    nextPlaybackTime = startAt + audioBuffer.duration;
  }

  function handleControl(raw) {
    var message;
    try { message = JSON.parse(raw); } catch (_) { return; }
    switch (message.type) {
      case 'ready':
        ready = true;
        console.info('[LiveAudio] AG2 LiveAgent session ready.');
        break;
      case 'subtitle': showSubtitle(message.payload || ''); break;
      case 'thinking': setThinking(message.payload !== false); break;
      case 'error': console.error('[LiveAudio] Backend error:', message.message); break;
    }
  }

  function scheduleReconnect() {
    if (shuttingDown) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(initLiveAudio, 2000);
  }

  async function initLiveAudio() {
    shuttingDown = false;
    ready = false;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }

    try {
      await ensureAudio();
      socket = new WebSocket(sessionUrl());
      socket.binaryType = 'arraybuffer';
      socket.onmessage = function (event) {
        if (typeof event.data === 'string') handleControl(event.data);
        else playPcm(event.data);
      };
      socket.onclose = function () {
        ready = false;
        setThinking(false);
        console.warn('[LiveAudio] Session disconnected; reconnecting.');
        scheduleReconnect();
      };
      socket.onerror = function (event) {
        console.error('[LiveAudio] WebSocket error:', event);
      };
    } catch (err) {
      console.error('[LiveAudio] Initialization failed:', err);
      scheduleReconnect();
    }
  }

  function destroyLiveAudio() {
    shuttingDown = true;
    ready = false;
    clearTimeout(reconnectTimer);
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }
    if (micProcessor) micProcessor.disconnect();
    if (micSource) micSource.disconnect();
    if (micStream) micStream.getTracks().forEach(function (track) { track.stop(); });
    if (audioContext) audioContext.close().catch(function () {});
    micProcessor = null;
    micSource = null;
    micStream = null;
    outputDestination = null;
    audioContext = null;
    nextPlaybackTime = 0;
  }

  window.initLiveAudio = initLiveAudio;
  window.resumeLiveAudio = resumeLiveAudio;
  window.destroyLiveAudio = destroyLiveAudio;
  window.toggleMic = toggleMic;
  window.setMicMuted = setMicMuted;

  // Backward-compatible names for integrations that used the old WebRTC API.
  window.initWebRTC = initLiveAudio;
  window.destroyWebRTC = destroyLiveAudio;
}());

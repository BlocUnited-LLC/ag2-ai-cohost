// The controller and every overlay attach to the same backend-owned conversation.
export const SAMPLE_RATE = 24000;
const MAX_UPLINK_BYTES = SAMPLE_RATE; // Drop stale mic frames after 500 ms of congestion.

export class SessionConnection {
  constructor({ role, token, onEvent = () => {}, onAudio = () => {}, onConnection = () => {} }) {
    Object.assign(this, { role, token, onEvent, onAudio, onConnection });
    this.socket = null;
    this.authenticated = false;
    this.closed = true;
    this.retry = 0;
    this.state = { status: 'idle', muted: false };
  }

  connect() {
    this.closed = false;
    clearTimeout(this.retryTimer);
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return;
    this.onConnection('connecting');
    const url = new URL('/session', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    let permanentError = false;
    let lastError = '';
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', role: this.role, token: this.token }));
      this.authTimer = setTimeout(() => {
        if (!this.authenticated) socket.close(4000, 'Authentication timed out');
      }, 10000);
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket || this.closed) return;
      if (typeof event.data !== 'string') {
        if (this.authenticated) this.onAudio(event.data);
        return;
      }
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'authenticated') {
        this.authenticated = true;
        this.retry = 0;
        clearTimeout(this.authTimer);
        this.onConnection('connected');
      } else if (message.type === 'state') {
        this.state = message;
        document.body.dataset.sessionStatus = message.status;
        document.body.dataset.sessionId = message.sessionId || '';
      } else if (message.type === 'error') {
        lastError = message.message || message.error || 'The cohost connection failed.';
        permanentError = /auth|unauthorized|forbidden|controller.*(busy|exists|connected|conflict)/i.test(message.code || '') || !this.authenticated;
      }
      this.onEvent(message);
    };
    socket.onerror = () => { /* onclose provides one consistent retry/error path. */ };
    socket.onclose = (event) => {
      if (socket !== this.socket) return;
      clearTimeout(this.authTimer);
      this.socket = null;
      this.authenticated = false;
      if (this.closed) return;
      permanentError ||= [1008, 4401, 4403, 4409].includes(event.code);
      if (permanentError) {
        this.closed = true;
        this.onConnection('failed', lastError || event.reason || 'Access denied. Reload the controls or copy a fresh overlay link.');
        return;
      }
      const delay = Math.min(15000, 750 * 2 ** this.retry++) + Math.random() * 250;
      this.onConnection('reconnecting', `Connection lost. Reconnecting in ${Math.ceil(delay / 1000)} seconds…`);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  send(message) {
    if (!this.authenticated || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  sendAudio(buffer) {
    if (this.role !== 'controller' || !this.authenticated || this.state.status !== 'running' || this.state.muted || this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > MAX_UPLINK_BYTES) {
      const now = Date.now();
      if (!this.congestionAt || now - this.congestionAt > 5000) {
        this.congestionAt = now;
        this.onEvent({ type: 'warning', message: 'Audio connection is slow. Skipping delayed microphone audio.' });
      }
      return;
    }
    this.socket.send(buffer);
  }

  disconnect() {
    this.closed = true;
    this.authenticated = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.authTimer);
    this.socket?.close(1000, 'Page closed');
    this.socket = null;
  }
}

// Playback works independently of microphone permission, including in OBS CEF.
export class AudioBridge {
  constructor({ enabled = true, onPcm = () => {}, onLevel = () => {}, onPlayback = () => {}, onError = () => {}, onState = () => {} } = {}) {
    Object.assign(this, { enabled, onPcm, onLevel, onPlayback, onError, onState });
    this.context = null;
    this.player = null;
    this.currentItem = null;
    this.pendingClears = new Map();
    this.captureGeneration = 0;
    this.muted = false;
  }

  async initialize() {
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.createPlayback().catch((error) => {
      this.context?.close().catch(() => {});
      this.context = this.player = this.output = this.outputGain = null;
      this.initializePromise = null;
      throw error;
    });
    return this.initializePromise;
  }

  async createPlayback() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support Web Audio. Use a current Chrome, Edge, or OBS release.');
    const context = new AudioContextClass({ latencyHint: 'interactive' });
    this.context = context;
    context.onstatechange = () => this.onState(context.state);
    if (!context.audioWorklet) throw new Error('AudioWorklet is unavailable. Open the local localhost URL or use HTTPS.');
    this.output = context.createMediaStreamDestination();
    this.outputGain = context.createGain();
    this.outputGain.gain.value = this.enabled ? 1 : 0;
    this.outputGain.connect(context.destination);
    await context.audioWorklet.addModule('/js/pcm-player-worklet.js');
    this.player = new AudioWorkletNode(context, 'pcm-player', {
      outputChannelCount: [1], processorOptions: { inputSampleRate: SAMPLE_RATE, prebufferMs: 120, maxBufferMs: 60000 }
    });
    this.player.connect(this.outputGain);
    this.player.connect(this.output);
    this.player.port.onmessage = ({ data }) => {
      if (data.type === 'playback' && data.itemId) this.onPlayback({ type: 'playback', itemId: data.itemId, playedMs: data.playedMs });
      if (data.type === 'cleared') {
        this.pendingClears.get(data.requestId)?.();
        this.pendingClears.delete(data.requestId);
      }
      if (data.type === 'overflow') this.onError('Playback fell behind. The queued response was cleared; interrupt and try again.');
    };
    this.onState(context.state);
    return this.output.stream;
  }

  async resume() {
    // Create/resume synchronously within the click handler, before permission prompts.
    const pending = this.initialize();
    const resume = this.context?.state === 'suspended' ? this.context.resume() : Promise.resolve();
    await pending;
    // resume() can remain pending until a gesture. Never stall socket setup on it.
    await Promise.race([resume, new Promise((resolve) => setTimeout(resolve, 350))]);
    this.onState(this.context.state);
    return this.context.state === 'running';
  }

  startItem(itemId) {
    this.currentItem = null;
    if (!this.enabled) return;
    this.onPlayback({ type: 'playback', itemId, playedMs: 0 });
    // Starting halfway through an unheard item would make its playback receipt
    // misleading. After suspended/hidden output, wait for the next complete item.
    if (!this.player || this.context?.state !== 'running') return;
    this.currentItem = itemId;
    this.player.port.postMessage({ type: 'start', itemId });
  }

  enqueue(buffer) {
    if (!this.enabled || !this.player || !this.currentItem || !buffer.byteLength) return;
    if (this.context.state !== 'running') { void this.clear(); return; }
    this.player.port.postMessage({ type: 'audio', itemId: this.currentItem, buffer }, [buffer]);
  }

  endItem(itemId) {
    if (this.enabled && this.player) this.player.port.postMessage({ type: 'end', itemId: itemId || this.currentItem });
  }

  async clear() {
    this.currentItem = null;
    if (!this.player) return;
    const requestId = (this.clearSequence = (this.clearSequence || 0) + 1);
    const receipt = new Promise((resolve) => this.pendingClears.set(requestId, resolve));
    this.player.port.postMessage({ type: 'clear', requestId });
    // A suspended worklet cannot acknowledge; its last report stays conservative.
    await Promise.race([receipt, new Promise((resolve) => setTimeout(resolve, 100))]);
    this.pendingClears.delete(requestId);
  }

  async setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.outputGain) this.outputGain.gain.value = this.enabled ? 1 : 0;
    await this.clear(); // Never resume a stale half-response after a visibility change.
  }

  async startMicrophone(deviceId = '') {
    const generation = ++this.captureGeneration;
    this.stopMicrophone(false);
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs localhost or HTTPS in a supported browser.');
    await this.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true
    } });
    if (generation !== this.captureGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException('Microphone startup cancelled.', 'AbortError');
    }
    this.micStream = stream;
    stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => {
      if (generation !== this.captureGeneration) return;
      this.stopMicrophone();
      this.onError('The microphone disconnected. Choose a device and resume your microphone.');
    }, { once: true }));
    try {
      await this.context.audioWorklet.addModule('/js/pcm-capture-worklet.js');
      if (generation !== this.captureGeneration) throw new DOMException('Microphone startup cancelled.', 'AbortError');
      this.capture = new AudioWorkletNode(this.context, 'pcm-capture', { outputChannelCount: [1], processorOptions: { targetSampleRate: SAMPLE_RATE } });
      this.capture.port.onmessage = ({ data }) => {
        if (generation !== this.captureGeneration) return;
        if (data.type === 'pcm' && !this.muted) this.onPcm(data.buffer);
        if (data.type === 'level') this.onLevel(this.muted ? 0 : data.rms);
      };
      this.micSource = this.context.createMediaStreamSource(stream);
      this.silentGain = this.context.createGain();
      this.silentGain.gain.value = 0;
      this.micSource.connect(this.capture);
      this.capture.connect(this.silentGain);
      this.silentGain.connect(this.context.destination);
    } catch (error) {
      this.stopMicrophone();
      throw error;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.micStream?.getAudioTracks().forEach((track) => { track.enabled = !this.muted; });
    if (this.muted) this.onLevel(0);
  }

  stopMicrophone(invalidate = true) {
    if (invalidate) this.captureGeneration++;
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micSource?.disconnect();
    this.capture?.disconnect();
    this.silentGain?.disconnect();
    this.capture?.port.close();
    this.micStream = this.micSource = this.capture = this.silentGain = null;
    this.onLevel(0);
  }

  destroy() {
    this.stopMicrophone();
    this.player?.port.postMessage({ type: 'clear' });
    this.player?.disconnect();
    this.context?.close().catch(() => {});
    this.context = this.player = this.output = this.outputGain = null;
    this.initializePromise = null;
    this.currentItem = null;
    this.pendingClears.forEach((resolve) => resolve());
    this.pendingClears.clear();
  }
}

export function showError(message) {
  const element = document.getElementById('error-message');
  element.textContent = message || '';
  element.hidden = !message;
}

export function audioError(error) {
  if (error.name === 'NotAllowedError') return 'Microphone permission was denied. Allow microphone access in your browser, then start again.';
  if (error.name === 'NotFoundError') return 'No microphone was found. Connect one, refresh the device list, and try again.';
  if (error.name === 'NotReadableError') return 'The microphone is unavailable. Check whether another application is using it.';
  if (error.name === 'OverconstrainedError') return 'That microphone is no longer available. Choose another device.';
  return error.message || 'Audio could not start. Check your microphone and browser settings.';
}

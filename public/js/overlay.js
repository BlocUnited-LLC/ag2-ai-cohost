import { AudioBridge, SessionConnection, showError } from './session.js';

const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get('token');
// A Browser Source captures everything this page renders, even in OBS preview.
// Keep operator notices off the broadcast unless diagnostics are explicitly opened.
$('overlay-notices').hidden = new URLSearchParams(location.search).get('diagnostics') !== '1';
let connection;
let connected = false;
let state = { status: 'idle' };
let avatarReady = false;
let sourceVisible = true;
let sourceActive = true;
let active = true;
let avatarFailure = '';
let audioFailure = '';
let connectionFailure = '';

const audio = new AudioBridge({
  onPlayback: (receipt) => connection?.send(receipt),
  onError: (message) => { audioFailure = message; showError(message); },
  onState: (status) => {
    $('enable-audio-btn').hidden = status === 'running';
    if (status === 'suspended' && audio.currentItem) void audio.clear();
    updateOutput();
  }
});

function updateOutput() {
  connection?.send({ type: 'output', active: Boolean(active && audio.enabled && audio.context?.state === 'running') });
}

function renderStatus() {
  if (!connected) return;
  $('connection-status').textContent = state.status === 'starting' ? 'The cohost is starting…' : state.status === 'running' ? '' : state.status === 'error' ? 'The cohost needs attention in the control page.' : 'Overlay connected · Start the cohost from your control page.';
}

function renderError() {
  showError(audioFailure || avatarFailure || connectionFailure || state.error || '');
}

async function enableAudio() {
  try {
    const running = await audio.resume();
    audioFailure = '';
    renderError();
    $('enable-audio-btn').hidden = running;
    if (avatarReady) {
      await window.resumeAudio();
      await window.setupHeadAudio(audio.output.stream);
    }
  } catch (error) {
    audioFailure = `Audio could not start: ${error.message}`;
    showError(audioFailure);
  }
}
$('enable-audio-btn').addEventListener('click', enableAudio);

async function loadAvatar() {
  try {
    // Isolate CDN/WebGL/avatar failures from networking and PCM audio.
    await import('./avatar.js');
    await window.initAvatar();
    avatarReady = true;
    await audio.initialize();
    await window.setupHeadAudio(audio.output.stream);
    if (audio.context.state === 'running') await window.resumeAudio();
  } catch (error) {
    avatarFailure = 'Avatar unavailable. Audio and captions still work. Check your internet connection and OBS graphics support.';
    showError(avatarFailure);
    console.error('[Overlay] Avatar initialization failed:', error);
  }
}

function connect() {
  if (!token) {
    $('connection-status').textContent = '';
    connectionFailure = 'This overlay needs its private link. Copy the Browser Source URL from the cohost control page.';
    renderError();
    return;
  }
  connection = new SessionConnection({
    role: 'viewer', token,
    onAudio: (buffer) => audio.enqueue(buffer),
    onConnection: (status, message) => {
      connected = status === 'connected';
      if (connected) {
        connectionFailure = '';
        updateOutput();
        renderError();
        renderStatus();
      } else {
        $('connection-status').textContent = message || 'Connecting to your cohost…';
        void audio.clear();
        if (status === 'failed') {
          connectionFailure = message;
          renderError();
        }
      }
    },
    onEvent: (message) => {
      if (message.type === 'state') {
        const previousId = state.sessionId;
        state = message;
        if (state.status !== 'running' || (previousId && previousId !== state.sessionId)) void audio.clear();
        $('subtitle-overlay').textContent = state.subtitle || '';
        $('thinking-indicator').hidden = !state.thinking;
        renderError();
        renderStatus();
      } else if (message.type === 'subtitle') {
        $('subtitle-overlay').textContent = message.payload || '';
      } else if (message.type === 'thinking') {
        $('thinking-indicator').hidden = !message.payload;
      } else if (message.type === 'audio_start') {
        audio.startItem(message.itemId);
      } else if (message.type === 'audio_end') {
        audio.endItem(message.itemId);
      } else if (message.type === 'audio_interrupted') {
        void audio.clear();
        $('subtitle-overlay').textContent = '';
        $('thinking-indicator').hidden = true;
      } else if (message.type === 'error') {
        state.error = message.message || message.error || 'The cohost encountered an error.';
        renderError();
      }
    }
  });
  connection.connect();
}

function updateVisibility() {
  // OBS emits its own lifecycle events; normal browser tab visibility is separate.
  const visible = active && sourceVisible && sourceActive && (window.obsstudio || !document.hidden);
  if (Boolean(visible) === audio.enabled) return;
  void audio.setEnabled(Boolean(visible));
  updateOutput();
  if (visible) void enableAudio();
}
window.addEventListener('obsSourceVisibleChanged', (event) => {
  sourceVisible = typeof event.detail === 'boolean' ? event.detail : event.detail?.visible !== false;
  updateVisibility();
});
window.addEventListener('obsSourceActiveChanged', (event) => {
  sourceActive = typeof event.detail === 'boolean' ? event.detail : event.detail?.active !== false;
  updateVisibility();
});
document.addEventListener('visibilitychange', updateVisibility);
window.addEventListener('pagehide', () => {
  active = false;
  updateOutput();
  connection?.disconnect();
  audio.destroy();
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  active = true;
  void enableAudio();
  connection?.connect();
  updateVisibility();
});

// No microphone capture or bootstrap credential fetch occurs on this page.
// The tiny PCM worklet must be ready before subscribing to live audio. Avatar
// loading happens independently and cannot delay the connection.
void audio.initialize().catch((error) => {
  audioFailure = `Audio unavailable: ${error.message}`;
  showError(audioFailure);
}).finally(connect);
void enableAudio();
void loadAvatar();
updateVisibility();

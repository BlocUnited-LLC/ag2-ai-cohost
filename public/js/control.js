import { AudioBridge, SessionConnection, showError, audioError } from './session.js';

const $ = (id) => document.getElementById(id);
let connection;
let connected = false;
let busy = false;
let state = { status: 'idle', muted: false, viewers: 0 };
let pageActive = true;
let bootstrapAttempt = 0;
let bootstrapTimer;
const audio = new AudioBridge({
  enabled: false,
  onPcm: (buffer) => connection?.sendAudio(buffer),
  onPlayback: (receipt) => connection?.send(receipt),
  onError: (message) => { showError(message); render(); },
  onState: () => updateOutput(),
  onLevel: (rms) => {
    const level = Math.min(100, Math.round(rms * 400));
    $('mic-level').style.width = `${level}%`;
    $('mic-level').parentElement.setAttribute('aria-valuenow', String(level));
  }
});

function updateOutput() {
  connection?.send({ type: 'output', active: Boolean(pageActive && audio.enabled && audio.context?.state === 'running') });
}

function render() {
  const running = state.status === 'running';
  const starting = state.status === 'starting';
  const hasMicrophone = Boolean(audio.micStream);
  $('start-btn').disabled = !connected || busy || starting || (running && hasMicrophone);
  $('start-btn').innerHTML = `<span aria-hidden="true">▶</span> ${running && !hasMicrophone ? 'Resume microphone' : 'Start cohost'}`;
  $('stop-btn').disabled = !connected || busy || (!running && !starting);
  $('mute-btn').disabled = !connected || !running || !hasMicrophone;
  $('interrupt-btn').disabled = !connected || !running;
  $('device-select').disabled = busy || hasMicrophone;
  $('mute-btn').textContent = state.muted ? 'Unmute microphone' : 'Mute microphone';
  $('mute-btn').setAttribute('aria-label', $('mute-btn').textContent);
  $('mute-btn').setAttribute('aria-pressed', String(Boolean(state.muted)));
  $('session-badge').textContent = starting ? 'STARTING' : running ? 'CONNECTED' : 'OFF AIR';
  document.body.dataset.viewers = String(state.viewers > 0);
  $('viewer-count').textContent = state.viewers ? `${state.viewers} overlay${state.viewers === 1 ? '' : 's'} connected` : 'No overlay connected';
  if (connected) {
    $('connection-status').textContent = busy ? 'Preparing your microphone…' : starting ? 'Starting your cohost…' : running ? (hasMicrophone ? state.muted ? 'Microphone muted' : 'Your cohost is listening' : 'Your conversation is still running') : state.status === 'error' ? 'The cohost needs your attention' : 'Ready when you are';
    $('session-hint').textContent = running ? (hasMicrophone ? 'Speak naturally. Interrupt whenever you need to.' : 'Resume your microphone to rejoin, or stop the conversation.') : 'Choose your microphone, then start when you are ready.';
  }
}

function onEvent(message) {
  if (message.type === 'state') {
    const previousStatus = state.status;
    const previousError = state.error;
    state = message;
    audio.setMuted(Boolean(state.muted));
    $('subtitle-overlay').textContent = state.subtitle || 'The conversation will appear here.';
    $('thinking-indicator').hidden = !state.thinking;
    if ((state.status === 'idle' || state.status === 'error') && (previousStatus === 'running' || previousStatus === 'starting')) {
      audio.stopMicrophone();
      void audio.clear();
    }
    if (state.error) showError(state.error);
    // Clear a resolved session error without erasing a newer local device error.
    else if (previousError && $('error-message').textContent === previousError) showError('');
    render();
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
    $('thinking-indicator').hidden = true;
  } else if (message.type === 'task') {
    const labels = { started: 'Working on', progress: 'Working on', completed: 'Completed', failed: 'Could not finish', expired: 'Timed out', cancelled: 'Cancelled' };
    $('task-status').textContent = `${labels[message.status] || 'Task'}: ${message.title || 'Background research'}`;
    $('task-status').hidden = false;
  } else if (message.type === 'error' || message.type === 'warning') {
    showError(message.message || message.error || 'The cohost encountered an error.');
  }
}

async function loadDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const selected = $('device-select').value;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
    $('device-select').replaceChildren(new Option('System default microphone', ''));
    devices.filter((device) => device.deviceId && device.deviceId !== 'default').forEach((device, index) => {
      $('device-select').add(new Option(device.label || `Microphone ${index + 1}`, device.deviceId));
    });
    if ([...$('device-select').options].some((option) => option.value === selected)) $('device-select').value = selected;
  } catch (error) { showError(audioError(error)); }
}

$('start-btn').addEventListener('click', async () => {
  if (!connected || busy) return;
  busy = true;
  showError('');
  render();
  try {
    await audio.startMicrophone($('device-select').value);
    if (!pageActive || !connected) throw new Error('The connection changed while starting. Please try again.');
    await loadDevices();
    audio.setMuted(false);
    connection.send({ type: 'mute', muted: false });
    if (state.status !== 'running' && !connection.send({ type: 'start' })) throw new Error('The backend disconnected. Please try again.');
  } catch (error) {
    audio.stopMicrophone();
    if (error.name !== 'AbortError') showError(audioError(error));
  } finally {
    busy = false;
    render();
  }
});

$('stop-btn').addEventListener('click', async () => {
  audio.stopMicrophone();
  await audio.clear();
  connection?.send({ type: 'stop' });
  render();
});

function toggleMute() {
  if ($('mute-btn').disabled) return;
  const muted = !state.muted;
  audio.setMuted(muted);
  state = { ...state, muted };
  connection.send({ type: 'mute', muted });
  render();
}

async function interrupt() {
  if ($('interrupt-btn').disabled) return;
  await audio.clear(); // Deliver the final local playback receipt before cancelling.
  connection?.send({ type: 'interrupt' });
}

$('mute-btn').addEventListener('click', toggleMute);
$('interrupt-btn').addEventListener('click', interrupt);
$('refresh-devices-btn').addEventListener('click', loadDevices);
navigator.mediaDevices?.addEventListener('devicechange', loadDevices);
$('monitor-toggle').addEventListener('change', async () => {
  try {
    if ($('monitor-toggle').checked) await audio.resume();
    await audio.setEnabled($('monitor-toggle').checked);
    updateOutput();
  } catch (error) {
    $('monitor-toggle').checked = false;
    await audio.setEnabled(false);
    updateOutput();
    showError(audioError(error));
  }
});

$('copy-overlay-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('overlay-url').value);
    $('copy-status').textContent = 'Copied. Paste this URL into your OBS Browser Source.';
  } catch {
    $('overlay-url').focus();
    $('overlay-url').select();
    $('copy-status').textContent = 'Select and copy the URL, then paste it into your OBS Browser Source.';
  }
});

document.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName) || event.target.isContentEditable) return;
  if (event.key.toLowerCase() === 'm') toggleMute();
  if (event.key === 'Escape') void interrupt();
});

async function bootstrap() {
  clearTimeout(bootstrapTimer);
  try {
    const response = await fetch('/api/bootstrap', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Local studio unavailable (${response.status}).`);
    const config = await response.json();
    if (!config.controllerToken || !config.viewerToken) throw new Error('The local studio returned an invalid configuration.');
    if (!pageActive) return;
    bootstrapAttempt = 0;
    const overlayUrl = new URL('/overlay', location.href);
    overlayUrl.hash = new URLSearchParams({ token: config.viewerToken }).toString();
    $('overlay-url').value = overlayUrl.href;
    const diagnosticsUrl = new URL(overlayUrl);
    diagnosticsUrl.searchParams.set('diagnostics', '1');
    $('diagnostics-link').href = diagnosticsUrl.href;
    $('diagnostics-link').hidden = false;
    $('copy-overlay-btn').disabled = false;
    connection?.disconnect();
    connection = new SessionConnection({
      role: 'controller', token: config.controllerToken, onEvent,
      onAudio: (buffer) => audio.enqueue(buffer),
      onConnection: (status, message) => {
        connected = status === 'connected';
        if (connected) { showError(''); updateOutput(); }
        else {
          $('connection-status').textContent = message || 'Connecting to your local studio…';
          void audio.clear();
          if (status === 'failed') { audio.stopMicrophone(); showError(message); }
        }
        render();
      }
    });
    connection.connect();
  } catch (error) {
    connected = false;
    showError(`${error.message} Check that both local services are running.`);
    $('connection-status').textContent = 'Waiting for your local studio…';
    render();
    if (pageActive) bootstrapTimer = setTimeout(bootstrap, Math.min(15000, 1000 * 2 ** bootstrapAttempt++));
  }
}

window.addEventListener('pagehide', () => {
  pageActive = false;
  updateOutput();
  connected = false;
  clearTimeout(bootstrapTimer);
  audio.destroy();
  connection?.disconnect();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { pageActive = true; void bootstrap(); }
});
void loadDevices();
void bootstrap();

'use strict';

const { test, expect } = require('@playwright/test');

const backend = `http://127.0.0.1:${process.env.COHOST_TEST_BACKEND_PORT || 5350}`;

async function stats(request) {
  return (await request.get(`${backend}/__test/stats`)).json();
}

async function emit(request, type, extra = {}) {
  const response = await request.post(`${backend}/__test/emit`, { data: { type, ...extra } });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ emitted: true });
}

async function instrument(context, { denyMicrophone = false } = {}) {
  // Isolate transport tests from third-party avatar downloads. The actual audio
  // engine, microphone capture, websocket, session manager and AG2 stream run.
  await context.route('**/js/avatar.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.initAvatar = async function () {
        const target = document.getElementById('avatar-container');
        if (target) {
          const label = document.createElement('div');
          label.textContent = 'Avatar test surface';
          label.dataset.testid = 'avatar-stub';
          label.style.cssText = 'position:absolute;inset:35% 10%;color:#888;text-align:center;font:24px sans-serif';
          target.appendChild(label);
        }
      };
      window.resumeAudio = async function () {};
      window.setupHeadAudio = function (stream) { window.__cohostTest.avatarStream = !!stream; };
      window.destroyAvatar = function () {};
    `,
  }));
  await context.addInitScript(({ deny }) => {
    const observed = window.__cohostTest = {
      microphoneRequests: 0, tracksStopped: 0, playerMessages: [],
      received: [], sent: [], sentBinaryBytes: 0, sockets: [], avatarStream: false, audioContexts: [],
    };
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      observed.microphoneRequests += 1;
      if (deny) throw new DOMException('Microphone permission denied by test', 'NotAllowedError');
      const stream = await originalGetUserMedia(constraints);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { observed.tracksStopped += 1; stop(); };
      }
      return stream;
    };
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        observed.sockets.push(this);
        this.addEventListener('message', ({ data }) => {
          if (typeof data === 'string') {
            try { observed.received.push(JSON.parse(data)); } catch (_) {}
          } else observed.received.push({ type: 'binary', bytes: data.byteLength || data.size });
        });
      }
      send(data) {
        if (typeof data === 'string') {
          try { observed.sent.push(JSON.parse(data)); } catch (_) {}
        } else observed.sentBinaryBytes += data.byteLength || data.size || 0;
        return super.send(data);
      }
    };
    if (window.AudioWorkletNode) {
      const NativeAudioWorkletNode = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends NativeAudioWorkletNode {
        constructor(context, name, options) {
          super(context, name, options);
          if (!observed.audioContexts.includes(context)) observed.audioContexts.push(context);
          const post = this.port.postMessage.bind(this.port);
          this.port.postMessage = (message, ...rest) => {
            observed.playerMessages.push({ name, type: message.type, bytes: message.buffer?.byteLength });
            return post(message, ...rest);
          };
        }
      };
    }
  }, { deny: denyMicrophone });
}

async function openController(page) {
  await page.goto('/control');
  await expect(page.locator('#start-btn')).toBeEnabled();
}

async function startController(page, request) {
  await openController(page);
  await page.locator('#start-btn').click();
  await expect(page.locator('body')).toHaveAttribute('data-session-status', 'running');
  await expect.poll(async () => (await stats(request)).starts).toBe(1);
  return page.locator('body').getAttribute('data-session-id');
}

async function openOverlay(context, request, { diagnostics = false } = {}) {
  const { viewerToken } = await (await request.get('/api/bootstrap')).json();
  const page = await context.newPage();
  await page.goto(`/overlay${diagnostics ? '?diagnostics=1' : ''}#token=${encodeURIComponent(viewerToken)}`);
  await expect.poll(() => page.evaluate(() => window.__cohostTest.received.some((item) => item.type === 'authenticated'))).toBeTruthy();
  return page;
}

test.beforeEach(async ({ context, request }) => {
  await request.post(`${backend}/__test/reset`);
  await instrument(context);
});

test.afterEach(async ({ request }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('provider-counters', {
      body: JSON.stringify(await stats(request), null, 2), contentType: 'application/json',
    });
  }
});

test('opening controls and overlays never starts a provider or captures overlay microphone', async ({ page, context, request }) => {
  await openController(page);
  const overlay = await openOverlay(context, request);
  await expect(overlay.locator('#enable-audio-btn')).toBeHidden();
  await expect(overlay.locator('#connection-status')).toBeHidden();
  await expect(overlay.locator('[data-testid="avatar-stub"]')).toBeVisible();
  await expect.poll(() => stats(request)).toMatchObject({ starts: 0, audioMessages: 0 });
  expect(await page.evaluate(() => window.__cohostTest.microphoneRequests)).toBe(0);
  expect(await overlay.evaluate(() => window.__cohostTest.microphoneRequests)).toBe(0);
  expect(await overlay.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});

test('operator notices and audio recovery controls require diagnostic preview mode', async ({ page, context, request }) => {
  await openController(page);
  const broadcastUrl = new URL(await page.locator('#overlay-url').inputValue());
  expect(broadcastUrl.pathname).toBe('/overlay');
  expect(broadcastUrl.search).toBe('');
  const clean = await openOverlay(context, request);
  const previewOpened = context.waitForEvent('page');
  await page.locator('#diagnostics-link').click();
  const preview = await previewOpened;
  await expect(preview).toHaveURL(/\/overlay\?diagnostics=1#token=/);
  await expect(preview.locator('#connection-status')).toBeVisible();
  await expect(preview.locator('#connection-status')).toContainText('Start the cohost from your control page');
  await expect(clean.locator('#connection-status')).toBeHidden();

  // A suspended output needs a user gesture in a regular browser. Even then,
  // setup controls must stay out of the recorded overlay.
  for (const overlay of [clean, preview]) {
    await expect.poll(() => overlay.evaluate(() => window.__cohostTest.audioContexts.length)).toBeGreaterThan(0);
    await overlay.evaluate(() => Promise.all(window.__cohostTest.audioContexts.map((audio) => audio.suspend())));
  }
  await expect(preview.locator('#enable-audio-btn')).toBeVisible();
  await expect(clean.locator('#enable-audio-btn')).toBeHidden();
});

test('missing overlay credentials are explained only in diagnostic preview mode', async ({ page }) => {
  await page.goto('/overlay');
  await expect(page.locator('#error-message')).toContainText('needs its private link');
  await expect(page.locator('#error-message')).toBeHidden();
  await page.goto('/overlay?diagnostics=1');
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('needs its private link');
  expect(await page.evaluate(() => window.__cohostTest.microphoneRequests)).toBe(0);
});

test('one producer broadcasts audio and captions to multiple overlays, including after reload', async ({ page, context, request }, testInfo) => {
  const sessionId = await startController(page, request);
  const first = await openOverlay(context, request);
  const second = await openOverlay(context, request);
  await expect(first.locator('body')).toHaveAttribute('data-session-id', sessionId);
  await expect(second.locator('body')).toHaveAttribute('data-session-id', sessionId);
  await expect.poll(async () => (await stats(request)).audioMessages).toBeGreaterThan(0);

  await emit(request, 'thinking');
  await expect(first.locator('#thinking-indicator')).toBeVisible();
  await emit(request, 'subtitle', { text: 'Welcome to the test broadcast.' });
  await emit(request, 'audio', { seconds: 0.4 });
  await emit(request, 'done');
  for (const overlay of [first, second]) {
    await expect(overlay.locator('#subtitle-overlay')).toContainText('Welcome to the test broadcast.');
    await expect(overlay.locator('#subtitle-overlay')).toBeVisible();
    await expect(overlay.locator('#connection-status')).toBeHidden();
    await expect(overlay.locator('#error-message')).toBeHidden();
    await expect.poll(() => overlay.evaluate(() => window.__cohostTest.playerMessages.some((item) => item.type === 'audio' && item.bytes > 0))).toBeTruthy();
    expect(await overlay.evaluate(() => window.__cohostTest.microphoneRequests)).toBe(0);
    expect(await overlay.evaluate(() => window.__cohostTest.sentBinaryBytes)).toBe(0);
  }
  expect((await stats(request)).starts).toBe(1);
  await testInfo.attach('controller-running', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await testInfo.attach('overlay-with-caption', { body: await first.screenshot({ omitBackground: true }), contentType: 'image/png' });

  await second.reload();
  await expect(second.locator('body')).toHaveAttribute('data-session-id', sessionId);
  await expect(second.locator('body')).toHaveAttribute('data-session-status', 'running');
  expect((await stats(request)).starts).toBe(1);
  expect((await stats(request)).closes).toBe(0);
  expect(await second.evaluate(() => window.__cohostTest.microphoneRequests)).toBe(0);
  await emit(request, 'subtitle', { text: 'Still the same live session.' });
  await expect(second.locator('#subtitle-overlay')).toContainText('Still the same live session.');
});

test('mute stops PCM uplink, interrupt clears actual playback, and stop closes the provider', async ({ page, context, request }) => {
  await startController(page, request);
  const overlay = await openOverlay(context, request);
  await expect.poll(async () => (await stats(request)).audioMessages).toBeGreaterThan(0);
  await page.locator('#mute-btn').click();
  await expect(page.locator('#mute-btn')).toHaveAttribute('aria-label', 'Unmute microphone');
  // Wait for the acknowledged mute state; network frames already in flight are
  // allowed to arrive before this quiet observation window.
  await expect.poll(() => page.evaluate(() => window.__cohostTest.received.some((item) => item.type === 'state' && item.muted))).toBeTruthy();
  const mutedCount = (await stats(request)).audioMessages;
  await expect(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((await stats(request)).audioMessages).toBe(mutedCount);
  }).toPass({ timeout: 1500 });

  await emit(request, 'audio', { seconds: 3 });
  await expect.poll(() => overlay.evaluate(() => window.__cohostTest.playerMessages.filter((item) => item.type === 'audio').length)).toBeGreaterThan(0);
  const clears = await overlay.evaluate(() => window.__cohostTest.playerMessages.filter((item) => item.type === 'clear').length);
  await page.locator('#interrupt-btn').click();
  await expect.poll(async () => (await stats(request)).interrupts).toBeGreaterThan(0);
  await expect.poll(() => overlay.evaluate(() => window.__cohostTest.playerMessages.filter((item) => item.type === 'clear').length)).toBeGreaterThan(clears);

  await page.locator('#mute-btn').click();
  await expect.poll(async () => (await stats(request)).audioMessages).toBeGreaterThan(mutedCount);
  await page.locator('#stop-btn').click();
  await expect(page.locator('body')).toHaveAttribute('data-session-status', 'idle');
  await expect(overlay.locator('body')).toHaveAttribute('data-session-status', 'idle');
  await expect.poll(() => stats(request)).toMatchObject({ starts: 1, closes: 1, clientCloses: 1 });
  expect(await page.evaluate(() => window.__cohostTest.tracksStopped)).toBeGreaterThan(0);
});

test('hidden OBS sources and late overlays cannot erase active playback progress', async ({ page, context, request }) => {
  await startController(page, request);
  const output = await openOverlay(context, request);
  const hidden = await openOverlay(context, request);
  await hidden.evaluate(() => window.dispatchEvent(new CustomEvent('obsSourceVisibleChanged', { detail: { visible: false } })));
  await expect.poll(() => hidden.evaluate(() => window.__cohostTest.sent.filter((item) => item.type === 'output').at(-1)?.active)).toBe(false);
  await emit(request, 'audio', { seconds: 1 });
  await expect.poll(async () => (await stats(request)).playbackMs).toBeGreaterThan(100);
  expect(await hidden.evaluate(() => window.__cohostTest.playerMessages.filter((item) => item.type === 'audio').length)).toBe(0);

  const late = await openOverlay(context, request);
  // Existing listeners continue this response. A listener who missed its start
  // waits for a full response instead of reporting an incorrect offset.
  await emit(request, 'audio', { seconds: 0.4, newItem: false });
  await expect.poll(() => late.evaluate(() => window.__cohostTest.received.some((item) => item.type === 'binary'))).toBeTruthy();
  expect(await late.evaluate(() => window.__cohostTest.playerMessages.filter((item) => item.type === 'audio').length)).toBe(0);
  expect((await stats(request)).playbackMs).toBeGreaterThan(100);
  await page.locator('#interrupt-btn').click();
  await expect.poll(async () => (await stats(request)).playedMs.at(-1)).toBeGreaterThan(100);

  await emit(request, 'audio', { seconds: 0.4 });
  await emit(request, 'done');
  await expect.poll(() => late.evaluate(() => window.__cohostTest.playerMessages.some((item) => item.type === 'audio'))).toBeTruthy();
  expect(await output.evaluate(() => window.__cohostTest.microphoneRequests)).toBe(0);
});

test('microphone permission denial is visible and creates no provider session', async ({ browser, request }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  await instrument(context, { denyMicrophone: true });
  try {
    const page = await context.newPage();
    await openController(page);
    await page.locator('#start-btn').click();
    await expect(page.locator('#error-message')).toBeVisible();
    await expect(page.locator('#error-message')).toContainText(/microphone|permission|denied/i);
    const microphoneError = await page.locator('#error-message').textContent();
    const overlay = await openOverlay(context, request);
    await expect(page.locator('#viewer-count')).toHaveText('1 overlay connected');
    await expect(page.locator('#error-message')).toBeVisible();
    await expect(page.locator('#error-message')).toHaveText(microphoneError);
    await overlay.close();
    await expect(page.locator('#viewer-count')).toHaveText('No overlay connected');
    await expect(page.locator('#error-message')).toBeVisible();
    await expect(page.locator('#error-message')).toHaveText(microphoneError);
    expect((await stats(request)).starts).toBe(0);
    await testInfo.attach('microphone-denied', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  } finally { await context.close(); }
});

test('a second controller is refused without starting another provider', async ({ page, context, request }) => {
  await startController(page, request);
  const second = await context.newPage();
  await second.goto('/control');
  await expect(second.locator('#error-message')).toBeVisible();
  await expect(second.locator('#error-message')).toContainText(/controller|another|already/i);
  expect((await stats(request)).starts).toBe(1);
  await expect(page.locator('body')).toHaveAttribute('data-session-status', 'running');
});

test('controller transport reconnect preserves its running session', async ({ page, request }) => {
  const sessionId = await startController(page, request);
  await page.evaluate(() => window.__cohostTest.sockets.at(-1).close());
  await expect.poll(() => page.evaluate(() => window.__cohostTest.sockets.length)).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => window.__cohostTest.received.filter((item) => item.type === 'authenticated').length)).toBeGreaterThan(1);
  await expect(page.locator('body')).toHaveAttribute('data-session-id', sessionId);
  await expect(page.locator('body')).toHaveAttribute('data-session-status', 'running');
  expect((await stats(request)).starts).toBe(1);
});

test('losing the controller stops the provider after the reconnect grace period', async ({ page, context, request }) => {
  await startController(page, request);
  const overlay = await openOverlay(context, request);
  await page.close();
  await expect(overlay.locator('body')).toHaveAttribute('data-session-status', 'idle');
  await expect.poll(() => stats(request)).toMatchObject({ starts: 1, closes: 1, clientCloses: 1 });
  expect(await overlay.evaluate(() => window.__cohostTest.microphoneRequests)).toBe(0);
});

test('provider errors stay off the broadcast and clear in controls and preview after restart or stop', async ({ page, context, request }) => {
  await startController(page, request);
  const overlay = await openOverlay(context, request);
  const preview = await openOverlay(context, request, { diagnostics: true });
  await emit(request, 'failure');
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(preview.locator('#error-message')).toBeVisible();
  await expect(preview.locator('#error-message')).toContainText('cohost connection failed');
  await expect(overlay.locator('#error-message')).toContainText('cohost connection failed');
  await expect(overlay.locator('#error-message')).toBeHidden();
  await expect(overlay.locator('#connection-status')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-session-status', 'error');
  await expect(overlay.locator('body')).toHaveAttribute('data-session-status', 'error');
  await expect.poll(() => stats(request)).toMatchObject({ closes: 1, clientCloses: 1 });
  await page.locator('#start-btn').click();
  await expect(page.locator('body')).toHaveAttribute('data-session-status', 'running');
  await expect(preview.locator('body')).toHaveAttribute('data-session-status', 'running');
  await expect(page.locator('#error-message')).toBeHidden();
  await expect(preview.locator('#error-message')).toBeHidden();
  await expect.poll(async () => (await stats(request)).starts).toBe(2);

  await emit(request, 'failure');
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(preview.locator('#error-message')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-session-status', 'error');
  // Stop is also a valid protocol command after an error, although the UI
  // already considers the failed provider stopped and offers a fresh start.
  await page.evaluate(() => window.__cohostTest.sockets.at(-1).send(JSON.stringify({ type: 'stop' })));
  await expect(page.locator('body')).toHaveAttribute('data-session-status', 'idle');
  await expect(preview.locator('body')).toHaveAttribute('data-session-status', 'idle');
  await expect(page.locator('#error-message')).toBeHidden();
  await expect(preview.locator('#error-message')).toBeHidden();
  await expect(preview.locator('#connection-status')).toContainText('Start the cohost from your control page');
});

test('bad credentials, hostile origins, and viewer control commands cannot start sessions', async ({ page, context, request }) => {
  const hostile = await request.get(`${backend}/api/bootstrap`, { headers: { Origin: 'https://untrusted.example' } });
  expect(hostile.status()).toBe(403);
  const hostileWs = await request.get(`${backend}/session`, { headers: {
    Origin: 'https://untrusted.example', Connection: 'Upgrade', Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'MDEyMzQ1Njc4OWFiY2RlZg==',
  } });
  expect(hostileWs.status()).toBe(403);
  const noOriginWs = await request.get(`${backend}/session`, { headers: {
    Connection: 'Upgrade', Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'MDEyMzQ1Njc4OWFiY2RlZg==',
  } });
  expect(noOriginWs.status()).toBe(403);

  // Loading a static asset URL gives this socket an allowed browser origin,
  // without booting a competing controller.
  await page.goto('/css/styles.css');
  const rejected = await page.evaluate(() => new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${location.host}/session`);
    const timer = setTimeout(() => reject(new Error('Bad credential socket was not closed')), 5000);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', role: 'controller', token: 'invalid' }));
    socket.onclose = ({ code }) => { clearTimeout(timer); resolve(code); };
  }));
  expect([1008, 4401, 4403]).toContain(rejected);

  const overlay = await openOverlay(context, request);
  await overlay.evaluate(() => window.__cohostTest.sockets.at(-1).send(JSON.stringify({ type: 'start' })));
  await expect.poll(() => overlay.evaluate(() => window.__cohostTest.received.some((item) => item.type === 'error'))).toBeTruthy();
  expect((await stats(request)).starts).toBe(0);
});

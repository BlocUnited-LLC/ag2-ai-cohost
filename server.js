'use strict';

const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';

// ---------------------------------------------------------------------------
// AG2 backend URL — configure via environment variable before starting:
//   AG2_BACKEND_URL=http://your-ag2-host:5050 node server.js
// Defaults to localhost:5050 (AG2 uvicorn default port).
// ---------------------------------------------------------------------------
const AG2_BACKEND_URL = (process.env.AG2_BACKEND_URL || 'http://127.0.0.1:5050').replace(/\/$/, '');
const origins = new Set([
  `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, `http://[::1]:${PORT}`,
  ...(process.env.COHOST_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
]);
const authorities = new Set([...origins].map(origin => new URL(origin).host));

function allowedRequest(req, requireOrigin = false) {
  // Check Host as well as Origin to reject DNS rebinding and foreign pages.
  if (!authorities.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  return origin ? origins.has(origin) : !requireOrigin;
}

// Serve .mjs files as JavaScript — some Express/mime versions omit this type,
// which causes AudioWorklet addModule() to throw an AbortError.
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (!allowedRequest(req)) return res.status(403).json({ error: 'Use the local cohost address.' });
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript');
  next();
});

// ---------------------------------------------------------------------------
// /session — WebSocket proxy to AG2 Python backend
//
// The browser opens a WebSocket connection to /session here. The Python
// backend bridges 24 kHz PCM audio to AG2 LiveAgent, which owns the OpenAI
// Realtime connection. API credentials never leave the backend.
// ---------------------------------------------------------------------------
const wsProxy = createProxyMiddleware({
  target:       AG2_BACKEND_URL,
  changeOrigin: false,
  // Explicit upgrade validation below; prevent an automatic second listener.
  ws:           false,
  on: {
    error: (err, req, res) => {
      console.error('[Server] /session proxy error:', err.message);
      if (res && typeof res.writeHead === 'function' && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'AI backend unavailable. Start npm run start:ag2.' }));
      } else if (res && typeof res.destroy === 'function') {
        res.destroy();
      }
    }
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use((req, res, next) => {
  // Preserve the /api prefix when forwarding requests.
  if (req.path.startsWith('/api/')) return wsProxy(req, res, next);
  next();
});
app.get(['/', '/control'], (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/overlay', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'overlay.html')));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Start — attach the WebSocket upgrade handler so WS /session is proxied
// ---------------------------------------------------------------------------
const server = app.listen(PORT, HOST, () => {
  console.log(`[Server] Controls: http://localhost:${PORT}/control`);
  console.log(`[Server] AG2 backend: ${AG2_BACKEND_URL}`);
  console.log(`[Server] Live audio /session → ${AG2_BACKEND_URL}/session`);
});

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/session' || !allowedRequest(req, true)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  wsProxy.upgrade(req, socket, head);
});

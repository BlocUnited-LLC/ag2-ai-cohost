'use strict';

const express = require('express');
const path    = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app  = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// AG2 backend URL — configure via environment variable before starting:
//   AG2_BACKEND_URL=http://your-ag2-host:5050 node server.js
// Defaults to localhost:5050 (AG2 uvicorn default port).
// ---------------------------------------------------------------------------
const AG2_BACKEND_URL = (process.env.AG2_BACKEND_URL || 'http://localhost:5050').replace(/\/$/, '');

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// /session — WebSocket proxy to AG2 Python backend
//
// AG2 uses WebSocket signaling (not REST POST /offer + /answer).
// The browser opens a WS connection to /session here; this server proxies it
// to the AG2 backend which handles ephemeral key exchange and session config.
// Audio travels P2P between the browser and OpenAI — AG2 is signaling only.
//
// See: https://docs.ag2.ai/latest/docs/user-guide/advanced-concepts/realtime-agent/webrtc/
// ---------------------------------------------------------------------------
const wsProxy = createProxyMiddleware({
  target:       AG2_BACKEND_URL,
  changeOrigin: true,
  ws:           true,
  on: {
    error: (err, req, res) => {
      console.error('[Server] /session proxy error:', err.message);
      // res may be a socket when upgrading — only call .status() on HTTP responses
      if (res && typeof res.status === 'function') {
        res.status(502).json({ error: 'AG2 backend unreachable', detail: err.message });
      }
    }
  }
});

app.use('/session', wsProxy);

// ---------------------------------------------------------------------------
// Start — attach the WebSocket upgrade handler so WS /session is proxied
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`[Server] AI Cohost running at http://localhost:${PORT}`);
  console.log(`[Server] AG2 backend: ${AG2_BACKEND_URL}`);
  console.log(`[Server] WebSocket /session → ${AG2_BACKEND_URL}/session`);
});

server.on('upgrade', wsProxy.upgrade);

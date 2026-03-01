'use strict';

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// AG2 backend URL — configure via environment variable before starting:
//   AG2_BACKEND_URL=http://your-ag2-host:8080 node server.js
// Defaults to localhost:8080 for local development.
// ---------------------------------------------------------------------------
const AG2_BACKEND_URL = (process.env.AG2_BACKEND_URL || 'http://localhost:8080').replace(/\/$/, '');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// /offer  — browser requests this to receive AG2's SDP offer
// Proxies to AG2 backend POST /offer and returns its JSON response.
// ---------------------------------------------------------------------------
app.post('/offer', async (req, res) => {
  try {
    const upstream = await fetch(`${AG2_BACKEND_URL}/offer`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('[Server] /offer proxy error:', err.message);
    res.status(502).json({ error: 'AG2 backend unreachable', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// /answer — browser posts its SDP answer here after ICE gathering completes
// Proxies to AG2 backend POST /answer.
// ---------------------------------------------------------------------------
app.post('/answer', async (req, res) => {
  try {
    const upstream = await fetch(`${AG2_BACKEND_URL}/answer`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body)
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('[Server] /answer proxy error:', err.message);
    res.status(502).json({ error: 'AG2 backend unreachable', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[Server] AI Cohost running at http://localhost:${PORT}`);
  console.log(`[Server] AG2 backend proxied from: ${AG2_BACKEND_URL}`);
});

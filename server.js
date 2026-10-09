'use strict';

/**
 * TechMart Empire: Ultra Simulator - Express server
 *  - serves the static game from /public
 *  - GET  /health        -> health check (Render)
 *  - POST /api/save      -> store a player's save (JSON file on disk)
 *  - GET  /api/load      -> load a player's save
 */

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const express = require('express');
const cors = require('cors');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SAVE_DIR = process.env.SAVE_DIR || path.join(__dirname, 'data', 'saves');
const MAX_SAVE_BYTES = 512 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '600kb' }));

/* ------------------------- tiny in-memory rate limiter ------------------------- */
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  let entry = hits.get(key);
  if (!entry || now - entry.start > 60000) {
    entry = { start: now, count: 0 };
    hits.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > 120) {
    return res.status(429).json({ ok: false, error: 'Too many requests, slow down.' });
  }
  return next();
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) {
    if (now - v.start > 60000) hits.delete(k);
  }
}, 60000).unref();

/* ----------------------------------- helpers ----------------------------------- */
function savePath(id) {
  return path.join(SAVE_DIR, id + '.json');
}

async function ensureSaveDir() {
  await fsp.mkdir(SAVE_DIR, { recursive: true });
}

function looksLikeSave(state) {
  return (
    state &&
    typeof state === 'object' &&
    !Array.isArray(state) &&
    typeof state.cash === 'number' &&
    Number.isFinite(state.cash) &&
    typeof state.day === 'number'
  );
}

/* ------------------------------------ routes ------------------------------------ */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.round(process.uptime()), time: new Date().toISOString() });
});

app.post('/api/save', rateLimit, async (req, res) => {
  try {
    const { playerId, state } = req.body || {};
    if (typeof playerId !== 'string' || !ID_RE.test(playerId)) {
      return res.status(400).json({ ok: false, error: 'Invalid playerId.' });
    }
    if (!looksLikeSave(state)) {
      return res.status(400).json({ ok: false, error: 'Invalid save state.' });
    }
    const savedAt = Date.now();
    const payload = JSON.stringify({ savedAt, state });
    if (Buffer.byteLength(payload) > MAX_SAVE_BYTES) {
      return res.status(413).json({ ok: false, error: 'Save too large.' });
    }
    await ensureSaveDir();
    const file = savePath(playerId);
    const tmp = file + '.' + process.pid + '.tmp';
    await fsp.writeFile(tmp, payload, 'utf8');
    await fsp.rename(tmp, file);
    return res.json({ ok: true, savedAt });
  } catch (err) {
    console.error('[save] failed:', err);
    return res.status(500).json({ ok: false, error: 'Could not write save.' });
  }
});

app.get('/api/load', rateLimit, async (req, res) => {
  try {
    const playerId = req.query.playerId;
    if (typeof playerId !== 'string' || !ID_RE.test(playerId)) {
      return res.status(400).json({ ok: false, error: 'Invalid playerId.' });
    }
    let raw;
    try {
      raw = await fsp.readFile(savePath(playerId), 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(404).json({ ok: false, error: 'not_found' });
      throw e;
    }
    const data = JSON.parse(raw);
    return res.json({ ok: true, savedAt: data.savedAt || 0, state: data.state });
  } catch (err) {
    console.error('[load] failed:', err);
    return res.status(500).json({ ok: false, error: 'Could not read save.' });
  }
});

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Unknown API route.' }));

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: IS_PROD ? '1h' : 0,
    etag: true
  })
);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Payload too large.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Bad JSON.' });
  }
  console.error(err);
  return res.status(500).json({ ok: false, error: 'Server error.' });
});

/* ------------------------------------- boot ------------------------------------- */
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('TechMart Empire running on port ' + PORT + ' (saves: ' + SAVE_DIR + ')');
});

function shutdown(signal) {
  console.log(signal + ' received, shutting down.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;

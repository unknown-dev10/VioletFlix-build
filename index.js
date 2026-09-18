// violetflix-api-proxy.js — VioletFlix Backend (VPS Panel Edition)
// Express proxy backend: movies · TV · anime · push notifications · sports · VPS panel
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const os         = require('os');

const app    = express();
const server = http.createServer(app);

// ── Config ───────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3015);
const HOST = process.env.HOST || '0.0.0.0';   // ← bind ALL interfaces so VPS panel can reach it
const PANEL_TOKEN = process.env.PANEL_TOKEN || 'violetkingdev10'; // set this in your VPS env

const _startedAt   = Date.now();
const _requestLog  = []; // rolling 200-entry request log
let   _totalReqs   = 0;
let   _errorReqs   = 0;
let   _cacheHits   = 0;

// ── Sources ──────────────────────────────────────────────────────────────────
const OMNISAVE_BASE  = 'https://videodownloader.site';
const JIKAN_BASE     = 'https://api.jikan.moe/v4';
const ANIKOTO_BASE   = 'https://anikotoapi.site';
const MEGAPLAY_BASE  = 'https://megaplay.buzz/stream';
const RAPIDAPI_KEY   = process.env.RAPIDAPI_KEY   || '7fbcf69594msh0df41a95c17a9c9p1abb86jsneab211071812';
const RAPIDAPI_HOST  = 'football-highlights-api.p.rapidapi.com';
const HIGHLIGHTLY_BASE = 'https://football-highlights-api.p.rapidapi.com';
const LIVESTREAM_BASE  = 'https://football-live-stream-api.p.rapidapi.com';
const LIVESTREAM_HOST  = 'football-live-stream-api.p.rapidapi.com';

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Panel-Token'],
}));
app.use(express.json());

// Friendly root — so opening IP:PORT doesn't show "Route not found"
app.get('/', (_req, res) => {
  res.status(200).json({
    name: 'VioletFlix API',
    status: 'online',
    panel: `/panel?token=${PANEL_TOKEN}`,
    health: '/api/health',
    docs: {
      movies: '/api/search/movie?q=',
      tv: '/api/search/tv?q=',
      anime: '/api/anime/search?q=',
      stream: '/api/stream/movie?tmdb_id=',
      sports: '/api/omegatech/sports?sport=football',
    },
    note: 'This is the API port. The website runs on a different port (usually 3000).',
  });
});


// Request logger / metrics
app.use((req, res, next) => {
  _totalReqs++;
  const entry = { ts: new Date().toISOString(), method: req.method, path: req.path, ip: req.ip || req.socket?.remoteAddress };
  _requestLog.push(entry);
  if (_requestLog.length > 200) _requestLog.shift();

  const origEnd = res.end.bind(res);
  res.end = (...args) => {
    entry.status = res.statusCode;
    if (res.statusCode >= 500) _errorReqs++;
    return origEnd(...args);
  };
  next();
});

// ── In-memory cache ───────────────────────────────────────────────────────────
const _cache = new Map();
function getCached(key) {
  const e = _cache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.exp) { _cache.delete(key); return undefined; }
  _cacheHits++;
  return e.data;
}
function setCached(key, data, ttlMs = 60_000) {
  _cache.set(key, { data, exp: Date.now() + ttlMs });
}
function cacheKey(...parts) { return parts.join(':'); }

// ── Panel auth middleware ─────────────────────────────────────────────────────
function requirePanel(req, res, next) {
  const token = req.headers['x-panel-token'] || req.query.token;
  if (token !== PANEL_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized — set X-Panel-Token header' });
  }
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchJSON(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(`Upstream ${r.status}: ${r.statusText}`);
  return r.json();
}

function ok(res, data) {
  if (res.headersSent) return;
  res.json(data);
}

function err(res, status, message) {
  _errorReqs++;
  if (res.headersSent) return;
  res.status(status).json({ error: message });
}

// ═══════════════════════════════════════════════════════════════════════════
//  PANEL / STATUS — VPS management endpoints
// ═══════════════════════════════════════════════════════════════════════════

// Public health — lightweight, no auth, VPS load-balancer probe
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    name: 'VioletFlix API',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - _startedAt) / 1000),
    port: PORT,
    host: HOST,
  });
});

// Full status — requires panel token
app.get('/api/panel/status', requirePanel, (_req, res) => {
  const mem = process.memoryUsage();
  const load = os.loadavg();
  res.json({
    service: 'VioletFlix API Proxy',
    version: '2.0.0',
    status: 'running',
    uptime_seconds: Math.floor((Date.now() - _startedAt) / 1000),
    uptime_human: fmtUptime(Date.now() - _startedAt),
    started_at: new Date(_startedAt).toISOString(),
    bind: `${HOST}:${PORT}`,
    node_version: process.version,
    pid: process.pid,
    memory: {
      rss_mb:        +(mem.rss / 1024 / 1024).toFixed(1),
      heap_used_mb:  +(mem.heapUsed / 1024 / 1024).toFixed(1),
      heap_total_mb: +(mem.heapTotal / 1024 / 1024).toFixed(1),
    },
    cpu_load_avg: { '1m': load[0].toFixed(2), '5m': load[1].toFixed(2), '15m': load[2].toFixed(2) },
    os: { platform: os.platform(), arch: os.arch(), hostname: os.hostname(), cpus: os.cpus().length },
    requests: {
      total: _totalReqs,
      errors: _errorReqs,
      error_rate: _totalReqs ? ((_errorReqs / _totalReqs) * 100).toFixed(1) + '%' : '0%',
    },
    cache: {
      entries: _cache.size,
      hits: _cacheHits,
      hit_rate: _totalReqs ? ((_cacheHits / _totalReqs) * 100).toFixed(1) + '%' : '0%',
    },
    endpoints: {
      health:   `http://${HOST}:${PORT}/api/health`,
      panel:    `http://${HOST}:${PORT}/api/panel/status`,
      logs:     `http://${HOST}:${PORT}/api/panel/logs`,
      movies:   `http://${HOST}:${PORT}/api/search/movie?q=`,
      tv:       `http://${HOST}:${PORT}/api/search/tv?q=`,
      anime:    `http://${HOST}:${PORT}/api/anime/search?q=`,
      stream:   `http://${HOST}:${PORT}/api/stream/movie?tmdb_id=`,
      sports:   `http://${HOST}:${PORT}/api/omegatech/sports?sport=football`,
    },
  });
});

// Rolling request log — requires panel token
app.get('/api/panel/logs', requirePanel, (_req, res) => {
  res.json({ count: _requestLog.length, logs: [..._requestLog].reverse() });
});

// Cache clear — requires panel token
app.delete('/api/panel/cache', requirePanel, (_req, res) => {
  const size = _cache.size;
  _cache.clear();
  res.json({ cleared: size, message: 'Cache cleared' });
});

// Panel info page (HTML) — quick browser view from VPS dashboard
app.get('/panel', requirePanel, (_req, res) => {
  const mem = process.memoryUsage();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>VioletFlix Panel</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0f;color:#e8e8f0;min-height:100vh;padding:32px 20px}
    h1{font-size:28px;font-weight:900;letter-spacing:-0.5px;margin-bottom:4px}
    h1 span{color:#7c3aed}
    .sub{color:#666;font-size:14px;margin-bottom:32px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-bottom:32px}
    .card{background:#111118;border:1px solid #1e1e2e;border-radius:12px;padding:20px}
    .card h3{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:10px}
    .card .val{font-size:28px;font-weight:700;color:#e8e8f0}
    .card .val.purple{color:#7c3aed}
    .card .val.green{color:#22c55e}
    .card .val.yellow{color:#eab308}
    .badge{display:inline-flex;align-items:center;gap:6px;background:#14532d;color:#22c55e;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;margin-bottom:24px}
    .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
    table{width:100%;border-collapse:collapse;background:#111118;border-radius:12px;overflow:hidden}
    th{background:#1e1e2e;color:#555;font-size:11px;text-transform:uppercase;letter-spacing:1px;padding:10px 16px;text-align:left}
    td{padding:10px 16px;border-bottom:1px solid #1a1a26;font-size:14px;font-family:monospace}
    tr:last-child td{border-bottom:none}
    .refresh{margin-top:24px;color:#555;font-size:12px;text-align:center}
    a{color:#7c3aed;text-decoration:none}
  </style>
</head>
<body>
  <h1>VioletFlix <span>Panel</span></h1>
  <p class="sub">API Proxy Management Dashboard — ${new Date().toLocaleString()}</p>
  <div class="badge"><span class="dot"></span> Running on ${HOST}:${PORT}</div>

  <div class="grid">
    <div class="card">
      <h3>Uptime</h3>
      <div class="val green">${fmtUptime(Date.now() - _startedAt)}</div>
    </div>
    <div class="card">
      <h3>Total Requests</h3>
      <div class="val purple">${_totalReqs.toLocaleString()}</div>
    </div>
    <div class="card">
      <h3>Memory (RSS)</h3>
      <div class="val">${+(mem.rss / 1024 / 1024).toFixed(1)} MB</div>
    </div>
    <div class="card">
      <h3>Cache Entries</h3>
      <div class="val yellow">${_cache.size}</div>
    </div>
    <div class="card">
      <h3>Error Rate</h3>
      <div class="val">${_totalReqs ? ((_errorReqs / _totalReqs) * 100).toFixed(1) : 0}%</div>
    </div>
    <div class="card">
      <h3>Cache Hit Rate</h3>
      <div class="val green">${_totalReqs ? ((_cacheHits / _totalReqs) * 100).toFixed(1) : 0}%</div>
    </div>
  </div>

  <table>
    <thead><tr><th>Endpoint</th><th>URL</th></tr></thead>
    <tbody>
      <tr><td>Health</td><td><a href="/api/health">/api/health</a></td></tr>
      <tr><td>Status JSON</td><td><a href="/api/panel/status?token=${PANEL_TOKEN}">/api/panel/status</a></td></tr>
      <tr><td>Request Logs</td><td><a href="/api/panel/logs?token=${PANEL_TOKEN}">/api/panel/logs</a></td></tr>
      <tr><td>Movie Search</td><td><a href="/api/search/movie?q=avengers">/api/search/movie?q=avengers</a></td></tr>
      <tr><td>Anime Search</td><td><a href="/api/anime/search?q=naruto">/api/anime/search?q=naruto</a></td></tr>
      <tr><td>Sports Proxy</td><td><a href="/api/omegatech/sports?sport=football">/api/omegatech/sports</a></td></tr>
    </tbody>
  </table>

  <p class="refresh">Auto-refresh: <a href="/panel?token=${PANEL_TOKEN}">Reload page</a> · PID ${process.pid} · Node ${process.version}</p>
  <script>setTimeout(()=>location.reload(), 30000)</script>
</body>
</html>`);
});

// ═══════════════════════════════════════════════════════════════════════════
//  MOVIES — search · details · stream · download
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/search/movie', async (req, res) => {
  try {
    const q = (req.query.q || 'avengers').trim();
    const key = cacheKey('movie-search', q);
    const cached = getCached(key);
    if (cached) return ok(res, cached);
    const data = await fetchJSON(`${OMNISAVE_BASE}/search?q=${encodeURIComponent(q)}&type=movie`);
    setCached(key, data, 120_000);
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/search/tv', async (req, res) => {
  try {
    const q = (req.query.q || 'breaking bad').trim();
    const key = cacheKey('tv-search', q);
    const cached = getCached(key);
    if (cached) return ok(res, cached);
    const data = await fetchJSON(`${OMNISAVE_BASE}/search?q=${encodeURIComponent(q)}&type=tv`);
    setCached(key, data, 120_000);
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/movie/:id', async (req, res) => {
  try {
    const key = cacheKey('movie-detail', req.params.id);
    const cached = getCached(key);
    if (cached) return ok(res, cached);
    const data = await fetchJSON(`${OMNISAVE_BASE}/details?subject_id=${req.params.id}`);
    setCached(key, data, 300_000);
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/tv/:id', async (req, res) => {
  try {
    const detailPath = req.query.path || '';
    let url = `${OMNISAVE_BASE}/details?subject_id=${req.params.id}`;
    if (detailPath) url += `&detail_path=${encodeURIComponent(detailPath)}`;
    const key = cacheKey('tv-detail', req.params.id, detailPath);
    const cached = getCached(key);
    if (cached) return ok(res, cached);
    const data = await fetchJSON(url);
    setCached(key, data, 300_000);
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/download', async (req, res) => {
  try {
    const { subject_id, season, episode, resolution } = req.query;
    if (!subject_id) return err(res, 400, 'subject_id required');
    let url = `${OMNISAVE_BASE}/download?subject_id=${subject_id}`;
    if (season)     url += `&season=${season}`;
    if (episode)    url += `&episode=${episode}`;
    if (resolution) url += `&preferred_resolution=${resolution}`;
    const data = await fetchJSON(url);
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/stream/movie', (req, res) => {
  const { tmdb_id } = req.query;
  if (!tmdb_id) return err(res, 400, 'tmdb_id required');
  ok(res, {
    embed: `https://embed.su/embed/movie/${tmdb_id}`,
    alternatives: [
      `https://vidsrc.to/embed/movie/${tmdb_id}`,
      `https://2embed.org/embed/movie/${tmdb_id}`,
      `https://vidlink.pro/movie/${tmdb_id}`,
    ],
  });
});

app.get('/api/stream/tv', (req, res) => {
  const { tmdb_id, season = 1, episode = 1 } = req.query;
  if (!tmdb_id) return err(res, 400, 'tmdb_id required');
  ok(res, {
    embed: `https://embed.su/embed/tv/${tmdb_id}/${season}/${episode}`,
    alternatives: [
      `https://vidsrc.to/embed/tv/${tmdb_id}/${season}/${episode}`,
      `https://2embed.org/embed/tv/${tmdb_id}/${season}/${episode}`,
      `https://vidlink.pro/tv/${tmdb_id}?s=${season}&e=${episode}`,
    ],
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ANIME — search · details · episodes · stream · catalog
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/anime/search', async (req, res) => {
  try {
    const q    = (req.query.q || 'naruto').trim();
    const page = req.query.page || 1;
    const key  = cacheKey('anime-search', q, page);
    const cached = getCached(key);
    if (cached) return ok(res, cached);
    const data = await fetchJSON(`${JIKAN_BASE}/anime?q=${encodeURIComponent(q)}&page=${page}&sfw`);
    const result = {
      results: (data.data || []).map(a => ({
        mal_id: a.mal_id, title: a.title, title_english: a.title_english,
        synopsis: a.synopsis, image: a.images?.jpg?.large_image_url,
        score: a.score, episodes: a.episodes, status: a.status,
        genres: (a.genres || []).map(g => g.name), type: a.type,
        year: a.year, season: a.season,
      })),
      pagination: data.pagination,
    };
    setCached(key, result, 120_000);
    ok(res, result);
  } catch (e) { err(res, 500, e.message); }
});

// IMPORTANT: /api/anime/search and /api/anime/stream must come before /api/anime/:id
app.get('/api/anime/stream', async (req, res) => {
  try {
    const { mal_id, episode = 1, lang = 'sub' } = req.query;
    const language = lang.toLowerCase();
    if (mal_id) {
      return ok(res, {
        player:  `${MEGAPLAY_BASE}/mal/${mal_id}/${episode}/${language}`,
        embed:   `https://vidlink.pro/anime/${mal_id}?ep=${episode}&lang=${language}`,
        backup:  `https://vidsrc.to/embed/anime/${mal_id}?ep=${episode}`,
        note: 'MegaPlay primary · VidLink fallback · VidSrc backup',
      });
    }
    const animeTitle = req.query.q;
    if (!animeTitle) return err(res, 400, 'Need mal_id or anime title (q)');
    const searchData = await fetchJSON(`${ANIKOTO_BASE}/search?q=${encodeURIComponent(animeTitle)}`);
    ok(res, { search_results: searchData?.data?.slice(0, 5) || [] });
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/anime/catalog', async (req, res) => {
  try {
    const page = req.query.page || 1;
    const type = req.query.type || 'recent';
    let url = `${ANIKOTO_BASE}/catalog?page=${page}`;
    if (type === 'series') url += '&type=series';
    const key = cacheKey('anime-catalog', type, page);
    const cached = getCached(key);
    if (cached) return ok(res, cached);
    const data = await fetchJSON(url);
    setCached(key, data, 120_000);
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/anime/:id/episodes', async (req, res) => {
  try {
    const page = req.query.page || 1;
    const key  = cacheKey('anime-episodes', req.params.id, page);
    const cached = getCached(key);
    if (cached) return ok(res, cached);
    const data = await fetchJSON(`${JIKAN_BASE}/anime/${req.params.id}/episodes?page=${page}`);
    const result = {
      episodes: (data.data || []).map(e => ({
        mal_id: e.mal_id, title: e.title, title_japanese: e.title_japanese,
        episode_number: e.mal_id, aired: e.aired, synopsis: e.synopsis, forum_url: e.url,
      })),
      pagination: data.pagination,
    };
    setCached(key, result, 300_000);
    ok(res, result);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/anime/:id', async (req, res) => {
  try {
    const key = cacheKey('anime-detail', req.params.id);
    const cached = getCached(key);
    if (cached) return ok(res, cached);
    const data = await fetchJSON(`${JIKAN_BASE}/anime/${req.params.id}/full`);
    if (!data.data) return err(res, 404, 'Not found');
    const a = data.data;
    const result = {
      mal_id: a.mal_id, title: a.title, title_english: a.title_english,
      title_japanese: a.title_japanese, synopsis: a.synopsis, background: a.background,
      image: a.images?.jpg?.large_image_url, trailer: a.trailer?.url,
      score: a.score, scored_by: a.scored_by, rank: a.rank, popularity: a.popularity,
      episodes: a.episodes, status: a.status, airing: a.airing,
      aired_from: a.aired?.from, aired_to: a.aired?.to, duration: a.duration,
      rating: a.rating, genres: (a.genres || []).map(g => g.name),
      studios: (a.studios || []).map(s => s.name),
      producers: (a.producers || []).map(p => p.name),
      type: a.type, season: a.season, year: a.year,
      relations: (a.relations || []).map(r => ({
        relation: r.relation,
        entries: r.entry?.map(e => ({ mal_id: e.mal_id, name: e.name, type: e.type })),
      })),
      theme_openings: a.theme?.openings || [],
      theme_endings:  a.theme?.endings  || [],
    };
    setCached(key, result, 600_000);
    ok(res, result);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/anime/series/:id', async (req, res) => {
  try {
    const data = await fetchJSON(`${ANIKOTO_BASE}/series/${req.params.id}`);
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  SPORTS — highlights · live streams · omegatech proxy
// ═══════════════════════════════════════════════════════════════════════════

async function fetchHighlightly(path, params = {}, ttlMs = 60_000) {
  const key = cacheKey('highlightly', path, JSON.stringify(params));
  const cached = getCached(key);
  if (cached) return cached;
  const url = new URL(`${HIGHLIGHTLY_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, String(v)); });
  const data = await fetchJSON(url.toString(), {
    headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': RAPIDAPI_HOST },
  });
  setCached(key, data, ttlMs);
  return data;
}

async function fetchLivestream(path, params = {}, ttlMs = 30_000) {
  const key = cacheKey('livestream', path, JSON.stringify(params));
  const cached = getCached(key);
  if (cached) return cached;
  const url = new URL(`${LIVESTREAM_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, String(v)); });
  const data = await fetchJSON(url.toString(), {
    headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': LIVESTREAM_HOST },
  });
  setCached(key, data, ttlMs);
  return data;
}

app.get('/api/sports/highlights', async (req, res) => {
  try {
    const data = await fetchHighlightly('/highlights', { page: req.query.page || 1, limit: req.query.limit || 10 });
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/sports/highlights/:matchId', async (req, res) => {
  try {
    const data = await fetchHighlightly(`/highlights/${req.params.matchId}`, {});
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/sports/live', async (req, res) => {
  try {
    const data = await fetchLivestream('/live', { sport: req.query.sport || 'football' }, 30_000);
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

app.get('/api/omegatech/sports', async (req, res) => {
  try {
    const sport = req.query.sport || 'football';
    const key   = cacheKey('omegatech', sport);
    const cached = getCached(key);
    if (cached) return ok(res, cached);
    const r    = await fetch(`https://omegatech-api.dixonomega.tech/api/Sport/sport-feeds?sport=${encodeURIComponent(sport)}`);
    const data = await r.json();
    setCached(key, data, 60_000);
    ok(res, data);
  } catch (e) { err(res, 500, e.message); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

function getSupabaseClient() {
  try {
    const { createClient } = require('@supabase/supabase-js');
    if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) return null;
    return createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  } catch { return null; }
}

app.post('/api/send-push', async (req, res) => {
  try {
    const { title, body, userId } = req.body;
    if (!userId || !title || !body) return err(res, 400, 'userId, title, and body are required');
    const supabase = getSupabaseClient();
    if (!supabase) return err(res, 500, 'Supabase not configured');
    const { data: user, error } = await supabase
      .from('user_profiles').select('push_token').eq('id', userId).single();
    if (error || !user?.push_token) return err(res, 404, 'No push token found');
    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: user.push_token, sound: 'default', title, body, data: { userId } }),
    });
    ok(res, await resp.json());
  } catch (e) { err(res, 500, e.message); }
});

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  err(res, 404, `Route not found: ${req.method} ${req.path}`);
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((e, _req, res, _next) => {
  console.error('[VioletFlix] Unhandled error:', e.message);
  err(res, 500, e.message);
});

// ═══════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);  const sec = s % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`].filter(Boolean).join(' ');
}

// Graceful shutdown
function shutdown(sig) {
  console.log(`\n[VioletFlix] ${sig} received — shutting down gracefully`);
  server.close(() => { console.log('[VioletFlix] Server closed.'); process.exit(0); });
  setTimeout(() => { console.error('[VioletFlix] Forced exit after timeout'); process.exit(1); }, 10_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ██╗   ██╗██╗ ██████╗ ██╗     ███████╗████████╗███████╗██╗     ██╗██╗  ██╗');
  console.log('  ██║   ██║██║██╔═══██╗██║     ██╔════╝╚══██╔══╝██╔════╝██║     ██║╚██╗██╔╝');
  console.log('  ██║   ██║██║██║   ██║██║     █████╗     ██║   █████╗  ██║     ██║ ╚███╔╝ ');
  console.log('  ╚██╗ ██╔╝██║██║   ██║██║     ██╔══╝     ██║   ██╔══╝  ██║     ██║ ██╔██╗ ');
  console.log('   ╚████╔╝ ██║╚██████╔╝███████╗███████╗   ██║   ██║     ███████╗██║██╔╝ ██╗');
  console.log('    ╚═══╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝   ╚═╝   ╚═╝     ╚══════╝╚═╝╚═╝  ╚═╝');
  console.log('');
  console.log(`  ✅ API Proxy running   → http://${HOST}:${PORT}`);
  console.log(`  📊 VPS Panel          → http://${HOST}:${PORT}/panel?token=${PANEL_TOKEN}`);
  console.log(`  💚 Health check       → http://${HOST}:${PORT}/api/health`);
  console.log(`  📋 Status JSON        → http://${HOST}:${PORT}/api/panel/status  [X-Panel-Token required]`);
  console.log(`  🔍 Movie search       → http://${HOST}:${PORT}/api/search/movie?q=`);
  console.log(`  🔍 Anime search       → http://${HOST}:${PORT}/api/anime/search?q=`);
  console.log(`  ⚽ Sports proxy       → http://${HOST}:${PORT}/api/omegatech/sports?sport=football`);
  console.log('');
  console.log(`  PID: ${process.pid}  Node: ${process.version}`);
  console.log('');
});

module.exports = { app, server };

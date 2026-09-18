const OMNISAVE_BASE = 'https://videodownloader.site';
const JIKAN_BASE = 'https://api.jikan.moe/v4';
const VIDSRC_BASE = 'https://vidsrc.to/embed';
const TWOEMBED_BASE = 'https://www.2embed.cc';
const MEGAPLAY_BASE = 'https://megaplay.buzz/stream';
const VIDLINK_BASE = 'https://vidlink.pro';
const ANIKOTO_BASE = 'https://anikotoapi.site';
const HIGHLIGHTLY_BASE = 'https://football-highlights-api.p.rapidapi.com';
const RAPIDAPI_KEY = '7fbcf69594msh0df41a95c17a9c9p1abb86jsneab211071812';
const RAPIDAPI_HOST = 'football-highlights-api.p.rapidapi.com';
const LIVESTREAM_BASE = 'https://football-live-stream-api.p.rapidapi.com';
const LIVESTREAM_HOST = 'football-live-stream-api.p.rapidapi.com';
const { getSportsApiResponse } = require('./sports-data');

const BLOCKED_DOWNLOAD_HOST_RE = /(?:doubleclick|googlesyndication|googleadservices|adsystem|adservice|adnxs|popads|popcash|propellerads|taboola|outbrain|trafficjunky|onclick|clickadu|exoclick|revcontent|mgid)/i;
const TRACKING_PARAM_RE = /^(?:utm_|affiliate$|aff(?:iliate)?_?id$|click_?id$|gclid$|fbclid$|yclid$|msclkid$|irclickid$|ref$|referrer$)/i;
const DOWNLOAD_FILENAME_RE = /[^a-z0-9._ -]+/gi;

function isBlockedAdUrl(url) {
  if (!url || typeof url !== 'string') return true;
  try {
    const parsed = new URL(url);
    return !/^https?:$/.test(parsed.protocol) || BLOCKED_DOWNLOAD_HOST_RE.test(parsed.hostname);
  } catch {
    return true;
  }
}

function protectUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    [...parsed.searchParams.keys()].forEach((key) => {
      if (TRACKING_PARAM_RE.test(key)) parsed.searchParams.delete(key);
    });
    return parsed.toString();
  } catch {
    return url;
  }
}

function safeDownloadFilename(title, resolution) {
  const base = `${title || 'video'} ${resolution || 'video'}`
    .replace(DOWNLOAD_FILENAME_RE, '_')
    .replace(/_+/g, '_')
    .trim() || 'video';
  return `${base}.mp4`;
}

function json(res, statusCode, body) {
  // Prevent "headers already sent" crash at the top-level catch
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'none'; object-src 'none'; frame-ancestors 'none';",
  });
  res.end(JSON.stringify(body));
}

// ─── Simple in-memory response cache for RapidAPI-backed endpoints ──────────
// Both RapidAPI subscriptions used here (football-highlights-api and
// football-live-stream-api) have a DAILY request quota on the Basic plan.
// Without this, every screen load/refresh re-hits RapidAPI even when nothing
// could possibly have changed in the last few seconds — this reuses recent
// responses instead, stretching the daily quota considerably. Only successful
// responses are cached; failures (including quota-exceeded) are never cached,
// so a real recovery is picked up immediately once the quota resets.
const rapidApiCache = new Map(); // key -> { data, expiresAt }

function cacheKey(base, path, params) {
  return `${base}:${path}:${JSON.stringify(params)}`;
}

function getCached(key) {
  const entry = rapidApiCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    rapidApiCache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCached(key, data, ttlMs) {
  rapidApiCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ─── football-highlights-api (RapidAPI) — real match data: lineups, stats, events ──
async function fetchHighlightly(path, params = {}, ttlMs = 60000) {
  const key = cacheKey('highlightly', path, params);
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const url = new URL(`${HIGHLIGHTLY_BASE}${path}`);
  Object.entries(params).forEach(([k, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(k, String(value));
  });
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    });
    if (!response.ok) return null; // never cache a failed/quota-exceeded response
    const data = await response.json();
    setCached(key, data, ttlMs);
    return data;
  } catch {
    return null;
  }
}

// ─── football-live-stream-api (RapidAPI) — PRIMARY sports source: 50+ matches
// per day with team logos and a real, confirmed-working m3u8 link per match ──
async function fetchLivestream(path, params = {}, ttlMs = 60000, shouldCache = () => true) {
  const key = cacheKey('livestream', path, params);
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const url = new URL(`${LIVESTREAM_BASE}${path}`);
  Object.entries(params).forEach(([k, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(k, String(value));
  });
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'x-rapidapi-host': LIVESTREAM_HOST,
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    });
    if (!response.ok) return null; // never cache a failed/quota-exceeded response
    const data = await response.json();
    // BUG FIX: this used to cache ANY HTTP 200 response, including a stream
    // link that came back empty (`{"url":""}`) because it just isn't ready
    // yet. That empty result then sat in the cache for a full 60s, so a
    // retry moments later got the same stale "not available" answer instead
    // of a fresh check — this was very likely the real cause of "stream not
    // available" errors even when the underlying API was working fine.
    if (shouldCache(data)) setCached(key, data, ttlMs);
    return data;
  } catch {
    return null;
  }
}


async function upstreamJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: `${OMNISAVE_BASE}/`,
      Origin: OMNISAVE_BASE,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Upstream ${response.status}: ${response.statusText || text}`);
  }

  return response.json();
}

// ─── Omegatech MovieBox Pro Provider ────────────────────────────────────────
async function tryOmegatechApi(subjectId, detailPath, season, episode, quality = '1080p') {
  if (!subjectId) return null;
  const url = new URL('https://api.omegatech.app/api/movie/MovieBox-pro');
  url.searchParams.set('action', 'download');
  url.searchParams.set('subjectId', subjectId);
  url.searchParams.set('id', subjectId);
  if (detailPath) url.searchParams.set('detailPath', detailPath);
  if (season) url.searchParams.set('se', season);
  if (episode) url.searchParams.set('ep', episode);

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || !data.streams || data.streams.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Normalize functions ──────────────────────────────────────────────────────
function normalizeDownloadPayload(data, downloads) {
  const downloadItems = Array.isArray(downloads) ? downloads : [];
  const title = data?.subject?.title || data?.title || 'Unknown Title';

  return {
    success: true,
    title,
    poster: data?.subject?.cover_url || data?.poster || '',
    adGuardActive: true,
    downloads: downloadItems
      .filter((d) => d.direct ? (d.streamUrl || d.downloadUrl) : d.url)
      .filter((d) => !isBlockedAdUrl(d.direct ? (d.streamUrl || d.downloadUrl) : d.url))
      .map((download) => {
        const resolution = download.resolution
          ? `${download.resolution}${String(download.resolution).toLowerCase().endsWith('p') ? '' : 'p'}`
          : 'Unknown';

        if (download.direct) {
          // ✅ CONFIRMED SAFE: these come from omegatech.app's own /stream and
          // /download endpoints (not the raw bcdnxw.hakunaymatata.com CDN),
          // which a direct curl test showed respond with 200, CORS *, and the
          // correct Content-Disposition on their own — no Referer-spoofing or
          // proxying needed at all. Use them exactly as given.
          const streamUrl = download.streamUrl || download.downloadUrl;
          const dlUrl = download.downloadUrl || download.streamUrl;
          return {
            resolution,
            size: download.size || 'Unknown',
            url: streamUrl,
            streamUrl,
            safeUrl: dlUrl,
            direct: true,
          };
        }

        // ⚠️ FALLBACK ONLY: the raw CDN link. This started returning 403 even
        // through our own spoofed-Referer proxy, so it's unreliable — kept
        // only for the rare case where omegatech.app's own proxy fields are
        // missing from the API response.
        const url = protectUrl(download.url);
        return {
          resolution,
          size: download.size || 'Unknown',
          url,
          streamUrl: `/api/download-file?mode=stream&url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeDownloadFilename(title, resolution))}`,
          safeUrl: `/api/download-file?mode=download&url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeDownloadFilename(title, resolution))}`,
          direct: false,
        };
      }),
    subtitles: (data?.subtitles || []).map((subtitle) => ({
      lang: subtitle.language_name || subtitle.lang,
      code: subtitle.language_code || subtitle.code,
      url: subtitle.url,
    })),
  };
}

function normalizeMovieSearch(data) {
  const list = Array.isArray(data)
    ? data
    : data?.data || data?.results || data?.items || data?.subjects || [];

  if (!Array.isArray(list)) return data;

  return {
    results: list.map((item) => {
      const subjectId = item.subject_id || item.subjectId || item.id || item.tmdb_id;
      return {
        ...item,
        subject_id: subjectId,
        subjectId,
        detailPath: item.detail_path || item.detailPath,
        title: item.title || item.name,
        poster: item.poster || item.cover || item.image,
      };
    }),
  };
}

const MOVIE_GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama',
  'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance',
  'Sci-Fi', 'Thriller', 'War', 'Western',
];

const TV_GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama',
  'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi',
  'Thriller', 'War', 'Western',
];

function unwrapItems(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.items || data?.results || data?.subjects || [];
}

function normalizeMovieItem(item) {
  const subjectId = item.subject_id || item.subjectId || item.id || item.tmdb_id;
  return {
    ...item,
    subject_id: subjectId,
    subjectId,
    detailPath: item.detail_path || item.detailPath,
    title: item.title || item.name,
    poster: item.poster || item.cover || item.image,
  };
}

function normalizeAnimeSummary(anime, { trimSynopsis = false } = {}) {
  const synopsis = anime.synopsis || '';
  return {
    mal_id: anime.mal_id,
    title: anime.title,
    title_english: anime.title_english,
    image: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url,
    score: anime.score,
    rank: anime.rank,
    episodes: anime.episodes,
    status: anime.status,
    airing: anime.airing,
    type: anime.type,
    year: anime.year,
    season: anime.season,
    genres: (anime.genres || []).map((genre) => genre.name),
    synopsis: trimSynopsis && synopsis ? `${synopsis.substring(0, 200)}${synopsis.length > 200 ? '...' : ''}` : synopsis,
  };
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.subject_id || item.subjectId || item.id || item.tmdb_id || item.title || item.name;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchOmnisave(query, type, page) {
  const url = new URL('/search', OMNISAVE_BASE);
  url.searchParams.set('q', query);
  url.searchParams.set('type', type);
  if (page) url.searchParams.set('page', page);
  return upstreamJson(url.toString());
}

async function searchOmnisaveItems(query, type, page) {
  const data = await searchOmnisave(query, type, page);
  return unwrapItems(data).map(normalizeMovieItem);
}

async function collectOmnisaveSearches(searches, limit) {
  const settled = await Promise.allSettled(searches.map(({ query, type, page }) => searchOmnisaveItems(query, type, page)));
  const items = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  return uniqueItems(items).slice(0, limit);
}

async function trendingMovies() {
  const year = new Date().getFullYear();
  return collectOmnisaveSearches([
    { query: String(year), type: 'movie' },
    { query: String(year - 1), type: 'movie' },
    { query: 'action', type: 'movie' },
  ], 30);
}

async function trendingTV() {
  const year = new Date().getFullYear();
  return collectOmnisaveSearches([
    { query: 'series', type: 'tv' },
    { query: String(year), type: 'tv' },
    { query: String(year - 1), type: 'tv' },
  ], 24);
}

async function trendingAnime() {
  const data = await upstreamJson(`${JIKAN_BASE}/top/anime?filter=airing&limit=25`);
  return (data.data || []).map((anime) => normalizeAnimeSummary(anime, { trimSynopsis: true }));
}

function routeParams(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/^\//, '');
  return rest ? rest.split('/').map(decodeURIComponent) : [];
}

// ─── Test route handlers ──────────────────────────────────────────────────────
async function handlePing(req, res) {
  json(res, 200, { pong: true, timestamp: Date.now() });
}

async function handleOmegatech(params, res) {
  try {
    const sport = params.get('sport') || 'football';
    const url = `https://omegatech-api.dixonomega.tech/api/Sport/sport-feeds?sport=${encodeURIComponent(sport)}`;
    const response = await fetch(url);
    const data = await response.json();
    json(res, 200, data);
  } catch (e) {
    console.error('Omegatech proxy error:', e);
    json(res, 500, { error: e.message });
  }
}

async function handleSportsApi(searchParams, res) {
  const query = Object.fromEntries(searchParams.entries());
  const { statusCode, body } = await getSportsApiResponse(query);
  json(res, statusCode, body);
  return true;
}

// ─── Main API Handler ──────────────────────────────────────────────────────────
async function handleApiRequest(req, res) {
  if (!req.url) return false;
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname, searchParams } = requestUrl;

  if (!pathname.startsWith('/api/')) return false;

  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return true;
  }

  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method Not Allowed' });
    return true;
  }

  try {
    // ─── Sports API ────────────────────────────────────────────────────────────
    if (pathname === '/api/sports') {
      return handleSportsApi(searchParams, res);
    }

    if (pathname === '/api/sports/download') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="match_replay.mp4"',
        'X-Content-Type-Options': 'nosniff',
        'X-Ad-Guard': 'active',
      });
      res.end('Binary data would be piped here...');
      return true;
    }


    //─── ADDED I GUESS──────────────────────────────────────────────────
if (pathname === '/api/sports/matches') {
  const sport = searchParams.get('sport') || 'football';
  const q = searchParams.get('q') || '';
  const url = `https://movie-webv3-production.up.railway.app/api/sports/matches?sport=${encodeURIComponent(sport)}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const response = await fetch(url, {
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',  // Force English team names
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  const data = await response.json();
  return json(res, response.status, data);
}

//── SPORTS DETAILS──────────────────────────────────────────────────
if (pathname === '/api/sportsrc/detail') {
  const id = searchParams.get('id');
  const category = searchParams.get('category') || 'football';
  if (!id) {
    return json(res, 400, { error: 'id required' });
  }
  const url = `https://api.sportsrc.org/?data=detail&category=${encodeURIComponent(category)}&id=${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  const data = await response.json();
  return json(res, response.status, data);
}

    // ─── Sky Sports RSS News ──────────────────────────────────────────────────
    if (pathname === '/api/skysports/news') {
      try {
        const rssUrl = 'https://www.skysports.com/rss/12040';
        const response = await fetch(rssUrl);
        const text = await response.text();

        const items = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        let index = 0;

        while ((match = itemRegex.exec(text)) !== null && index < 20) {
          const itemXml = match[1];
          // ✅ Fix: handle CDATA correctly
          const title = (itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || 'Sport News').replace(/<[^>]*>/g, '');
          const description = (itemXml.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/)?.[1] || '').replace(/<[^>]*>/g, '').slice(0, 200);
          const imageMatch = itemXml.match(/<enclosure[^>]*url="([^"]*)"/);
          const image = imageMatch?.[1] || null;
          const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
          const date = pubDate.split(' ').slice(0, 4).join(' ') || new Date().toLocaleDateString();
          const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';

          items.push({
            id: `sky-${index}`,
            title: title || 'Sports Update',
            summary: description || 'Click to read more about this story.',
            image,
            source: 'Sky Sports',
            publishedAt: date,
            url: link,
          });
          index++;
        }

        return json(res, 200, { success: true, news: items });
      } catch (error) {
        console.error('Sky Sports RSS error:', error);
        return json(res, 500, { success: false, error: 'Failed to fetch Sky Sports news' });
      }
    }

    // ─── Omegatech Search & Trending (optional) ──────────────────────────────
    if (pathname === '/api/omegatech/search') {
      const keyword = searchParams.get('keyword');
      if (!keyword) { json(res, 400, { error: 'keyword required' }); return true; }
      const url = `https://api.omegatech.app/api/movie/MovieBox-pro?action=search&keyword=${encodeURIComponent(keyword)}`;
      const data = await fetch(url).then(r => r.json());
      return json(res, 200, data);
    }

    if (pathname === '/api/omegatech/trending') {
      const url = `https://api.omegatech.app/api/movie/MovieBox-pro?action=trending`;
      const data = await fetch(url).then(r => r.json());
      return json(res, 200, data);
    }

    // ─── Search Movie/TV (OmniSave) ──────────────────────────────────────────
    if (pathname === '/api/search/movie' || pathname === '/api/search/tv') {
      const type = pathname.endsWith('/tv') ? 'tv' : 'movie';
      const q = searchParams.get('q') || searchParams.get('query') || (type === 'movie' ? 'avengers' : 'breaking bad');
      const data = await upstreamJson(`${OMNISAVE_BASE}/search?q=${encodeURIComponent(q)}&type=${type}`).catch(() => null);
      json(res, 200, data ? normalizeMovieSearch(data) : { results: [], source: 'unavailable', warning: 'Movie provider is currently unavailable' });
      return true;
    }

    // ─── Movie Detail ──────────────────────────────────────────────────────────
    const movieParts = routeParams(pathname, '/api/movie');
    if (movieParts?.length === 1) {
      const data = await upstreamJson(`${OMNISAVE_BASE}/details?subject_id=${encodeURIComponent(movieParts[0])}`);
      json(res, 200, data);
      return true;
    }

    // ─── TV Detail ─────────────────────────────────────────────────────────────
    const tvParts = routeParams(pathname, '/api/tv');
    if (tvParts?.length === 1) {
      const detailPath = searchParams.get('path') || '';
      const url = new URL('/details', OMNISAVE_BASE);
      url.searchParams.set('subject_id', tvParts[0]);
      if (detailPath) url.searchParams.set('detail_path', detailPath);
      const data = await upstreamJson(url.toString());
      json(res, 200, data);
      return true;
    }

    // ─── Download File (proxy) ────────────────────────────────────────────────
if (pathname === '/api/download-file') {
  const target = protectUrl(searchParams.get('url') || '');
  if (isBlockedAdUrl(target)) {
    json(res, 400, { success: false, error: 'Blocked unsafe download URL.', adGuardActive: true });
    return true;
  }

  // 'stream' = inline playback (used by the video player — needs Range support
  // for seeking and to avoid buffering the whole file before playing).
  // 'download' (default, back-compat) = forces a file download.
  const mode = searchParams.get('mode') === 'stream' ? 'stream' : 'download';

  const requestedName = (searchParams.get('filename') || 'video.mp4')
    .replace(DOWNLOAD_FILENAME_RE, '_')
    .replace(/_+/g, '_')
    .trim() || 'video.mp4';

  // ✅ CRITICAL FIX: Use the correct Referer for Omegatech CDNs
  const isOmegatech = target.includes('bcdnxw.hakunaymatata.com') || target.includes('stream.omegatech.app');
  const rangeHeader = req.headers['range'];

  const upstream = await fetch(target, {
    headers: {
      Accept: 'video/*, application/octet-stream, */*',
      Referer: isOmegatech ? 'https://api.omegatech.app/' : `${OMNISAVE_BASE}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      // Forward the browser's Range request so seeking/scrubbing works and so
      // large files (100MB+) don't have to fully download before playing.
      ...(mode === 'stream' && rangeHeader ? { Range: rangeHeader } : {}),
    },
    redirect: 'follow',
  });

  if (!upstream.ok && upstream.status !== 206) {
    json(res, upstream.status, { success: false, error: `Download provider error: ${upstream.status}`, adGuardActive: true });
    return true;
  }

  const responseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    'Content-Disposition': mode === 'stream'
      ? `inline; filename="${requestedName.replace(/"/g, '')}"`
      : `attachment; filename="${requestedName.replace(/"/g, '')}"`,
    'X-Content-Type-Options': 'nosniff',
    'X-Ad-Guard': 'active',
    ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length') } : {}),
    ...(mode === 'stream' ? {
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      ...(upstream.headers.get('content-range') ? { 'Content-Range': upstream.headers.get('content-range') } : {}),
    } : {}),
  };

  res.writeHead(mode === 'stream' && upstream.status === 206 ? 206 : 200, responseHeaders);

  // ✅ FIX: Catch streaming errors locally to prevent global catch from re-sending headers
  try {
    if (upstream.body && typeof upstream.body.pipe === 'function') {
      upstream.body.pipe(res);
    } else if (upstream.body) {
      const { Readable } = require('stream');
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (streamError) {
    console.error('Download stream error:', streamError);
    try { res.end(); } catch (e) {} // Ensure response ends gracefully
  }
  return true;
}

    // ─── DOWNLOAD (Omegatech + fallbacks) ─────────────────────────────────────
    if (pathname === '/api/download') {
      const subjectId = searchParams.get('subject_id');
      const detailPath = searchParams.get('detail_path');
      const season = searchParams.get('season');
      const episode = searchParams.get('episode');
      const quality = searchParams.get('quality') || '1080p';

      if (!subjectId) {
        json(res, 400, { error: 'subject_id required' });
        return true;
      }

      // 🔥 Try Omegatech first
      const omegatechData = await tryOmegatechApi(subjectId, detailPath, season, episode, quality);
      if (omegatechData) {
        const downloadItems = [];

        // ✅ PRIMARY: omegatech.app's own /stream and /download endpoints —
        // confirmed via direct curl test to respond 200 with correct CORS and
        // Content-Disposition on their own, no Referer-spoofing needed. The
        // raw bcdnxw.hakunaymatata.com CDN link (used below only as a last
        // resort) started returning 403 even through our own spoofed-Referer
        // proxy, so these are now the reliable choice.
        if (omegatechData.proxy) {
          ['1080p', '720p', '480p'].forEach((q) => {
            const rawStream = omegatechData.proxy[`stream${q}`];
            const rawDownload = omegatechData.proxy[`download${q}`];
            if (!rawStream && !rawDownload) return;
            const toHttps = (u) => (u && u.startsWith('http:') ? u.replace('http:', 'https:') : u);
            // Best-effort size: the streams[] array only ever carries a size
            // for whichever single quality the upstream call actually returned.
            const matchedStream = (omegatechData.streams || []).find((s) => s.quality === q);
            downloadItems.push({
              resolution: q,
              size: matchedStream?.size ? `${Math.round(Number(matchedStream.size) / (1024 * 1024))} MB` : 'Unknown',
              streamUrl: toHttps(rawStream) || null,
              downloadUrl: toHttps(rawDownload) || null,
              direct: true,
            });
          });
        }

        // ⚠️ FALLBACK ONLY: raw CDN link, used only if the proxy object above
        // gave us nothing at all.
        if (downloadItems.length === 0) {
          (omegatechData.streams || []).forEach((stream) => {
            const url = stream.originalUrl || stream.url || omegatechData.bestQuality;
            if (!url) return;
            downloadItems.push({
              resolution: stream.quality || 'Unknown',
              size: stream.size ? `${Math.round(Number(stream.size) / (1024 * 1024))} MB` : 'Unknown',
              url: url.startsWith('http:') ? url.replace('http:', 'https:') : url,
              direct: false,
            });
          });
        }

        const payload = {
          subject: { title: omegatechData.title || detailPath || 'Content', cover_url: omegatechData.cover || '' }
        };
        return json(res, 200, normalizeDownloadPayload(payload, downloadItems));
      }

      // ⚠️ Fallback: Aoneroom / VidLink / AnimeStream
      async function tryAoneroom() {
        try {
          const apiUrl = new URL('/api/download', 'https://aoneroom.com');
          apiUrl.searchParams.set('subject_id', subjectId);
          if (detailPath) apiUrl.searchParams.set('detail_path', detailPath);
          if (season) apiUrl.searchParams.set('season', season);
          if (episode) apiUrl.searchParams.set('episode', episode);
          if (quality) apiUrl.searchParams.set('preferred_resolution', quality);
          return await upstreamJson(apiUrl.toString());
        } catch { return null; }
      }

      async function tryVidlink() {
        try {
          const tmdbMatch = subjectId.match(/tt\d+/);
          if (!tmdbMatch && !detailPath) return null;
          const vidSources = [];
          if (tmdbMatch) {
            vidSources.push(
              `${VIDLINK_BASE}/movie/${tmdbMatch[0]}`,
              `${VIDSRC_BASE}/movie/${tmdbMatch[0]}`
            );
          }
          if (vidSources.length === 0) return null;
          return {
            subject: { title: detailPath || 'Movie' },
            downloads: vidSources.map((url, i) => ({
              resolution: i === 0 ? 1080 : 720,
              url,
              headers: {
                Referer: 'https://vidlink.pro/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            })),
            subtitles: []
          };
        } catch { return null; }
      }

      async function tryAnimeStream() {
        try {
          const malMatch = subjectId.match(/^(\d+)$/);
          if (!malMatch) return null;
          const ep = episode || '1';
          const sources = [
            { name: 'MegaPlay', url: `${MEGAPLAY_BASE}/mal/${malMatch[1]}/${ep}/sub` },
            { name: 'VidSrc', url: `${VIDSRC_BASE}/anime/${malMatch[1]}/${ep}` },
            { name: 'VidLink', url: `${VIDLINK_BASE}/anime/${malMatch[1]}?ep=${ep}&lang=sub` }
          ];
          return {
            subject: { title: detailPath || 'Anime' },
            downloads: sources.map((s, i) => ({
              resolution: i === 0 ? 1080 : 720,
              url: s.url,
              headers: {
                Referer: s.name === 'MegaPlay' ? 'https://megaplay.buzz/' : 'https://vidsrc.to/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            })),
            subtitles: []
          };
        } catch { return null; }
      }

      let data = await tryAoneroom();
      let downloads = data?.downloads || null;

      if (!downloads || (Array.isArray(downloads) && downloads.length === 0)) {
        data = await tryVidlink();
        downloads = data?.downloads || null;
      }

      if (!downloads || (Array.isArray(downloads) && downloads.length === 0)) {
        data = await tryAnimeStream();
        downloads = data?.downloads || null;
      }

      if (Array.isArray(downloads) && downloads.length > 0) {
        return json(res, 200, normalizeDownloadPayload(data, downloads));
      }

      const tmdbMatch = subjectId.match(/tt\d+/);
      if (tmdbMatch) {
        const isTv = false;
        const streamPath = isTv ? '/api/stream/tv' : '/api/stream/movie';
        const streamRes = await fetch(`http://localhost:${process.env.PORT || 3050}${streamPath}?tmdb_id=${tmdbMatch[0]}${isTv ? `&season=${season || 1}&episode=${episode || 1}` : ''}`, {
          headers: { Accept: 'application/json' }
        });
        if (streamRes.ok) {
          const streamData = await streamRes.json();
          const streamDownloads = (streamData.sources || []).map((s, i) => ({
            resolution: i === 0 ? '1080p' : '720p',
            size: 'Stream',
            url: s.url,
            headers: {
              Referer: s.url.includes('vidsrc') ? 'https://vidsrc.to/' : 'https://vidlink.pro/',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          }));
          return json(res, 200, normalizeDownloadPayload({ subject: { title: detailPath || 'Content' } }, streamDownloads));
        }
      }

      json(res, 404, { success: false, error: 'No direct download links found for this content.', adGuardActive: true });
      return true;
    }

    // ─── STREAM (movie/tv) ────────────────────────────────────────────────────
    if (pathname === '/api/stream/movie' || pathname === '/api/stream/tv') {
      const tmdbId = searchParams.get('tmdb_id');
      const subjectId = searchParams.get('subject_id');
      const detailPath = searchParams.get('detail_path');
      // Only read season/episode if they are explicitly provided (no defaults)
      const season = searchParams.get('season') || undefined;
      const episode = searchParams.get('episode') || undefined;
      const quality = searchParams.get('quality') || '1080p';

      // 🔥 Try Omegatech first if we have subjectId and detailPath
      if (subjectId && detailPath) {
        // For movies (pathname === '/api/stream/movie'), we don't pass se/ep
        // For TV, we pass them only if they are provided (they will be from frontend)
        const data = await tryOmegatechApi(
          subjectId,
          detailPath,
          pathname === '/api/stream/tv' ? season : undefined,
          pathname === '/api/stream/tv' ? episode : undefined,
          quality
        );
        if (data) {
          // ✅ PRIMARY: omegatech.app's own stream endpoint — confirmed safe
          // via direct curl test (200, correct CORS, inline disposition, no
          // Referer needed). This was previously checked LAST, after the raw
          // CDN link — meaning the app almost always picked the unreliable
          // (now 403ing) raw link first and only reached this safe one if
          // both other fields were missing. That's very likely why TV/anime
          // streams sat there loading forever: waiting on a blocked request.
          const directStream = data.proxy?.stream1080p || data.proxy?.stream720p || data.proxy?.stream480p;
          if (directStream) {
            const safeUrl = directStream.startsWith('http:') ? directStream.replace('http:', 'https:') : directStream;
            return json(res, 200, {
              sources: [{ name: 'Omegatech', url: safeUrl, quality }],
              embed: safeUrl,
              alternatives: []
            });
          }

          // ⚠️ FALLBACK ONLY: raw CDN link — needs our Referer-spoofing proxy,
          // and has been unreliable (403s). Only used if the safe field above
          // is completely missing from the API response.
          const rawStream = data.bestQuality || data.streams[0]?.originalUrl;
          if (rawStream) {
            const safeUrl = rawStream.startsWith('http:') ? rawStream.replace('http:', 'https:') : rawStream;
            const proxiedUrl = `/api/download-file?mode=stream&url=${encodeURIComponent(safeUrl)}&filename=${encodeURIComponent('video.mp4')}`;
            return json(res, 200, {
              sources: [{ name: 'Omegatech', url: proxiedUrl, quality }],
              embed: proxiedUrl,
              alternatives: []
            });
          }
        }
      }

      // ⚠️ Fallback to old embed providers (requires tmdb_id)
      if (!tmdbId) {
        json(res, 400, { error: 'tmdb_id required (or subjectId+detailPath for Omegatech)' });
        return true;
      }
      const safeTmdbId = encodeURIComponent(tmdbId);
      if (pathname === '/api/stream/movie') {
        const sources = [
          { name: 'VidSrc', url: `${VIDSRC_BASE}/movie/${safeTmdbId}` },
          { name: '2Embed', url: `${TWOEMBED_BASE}/embed/${safeTmdbId}` },
          { name: 'MegaPlay', url: `${VIDLINK_BASE}/movie/${safeTmdbId}` },
        ];
        return json(res, 200, {
          sources,
          embed: sources[0].url,
          alternatives: sources.slice(1).map((source) => source.url),
        });
      } else {
        const safeSeason = encodeURIComponent(season || '1');
        const safeEpisode = encodeURIComponent(episode || '1');
        const sources = [
          { name: 'VidSrc', url: `${VIDSRC_BASE}/tv/${safeTmdbId}/${safeSeason}/${safeEpisode}` },
          { name: '2Embed', url: `${TWOEMBED_BASE}/embedtv/${safeTmdbId}&s=${safeSeason}&e=${safeEpisode}` },
          { name: 'MegaPlay', url: `${VIDLINK_BASE}/tv/${safeTmdbId}/${safeSeason}/${safeEpisode}` },
        ];
        return json(res, 200, {
          sources,
          embed: sources[0].url,
          alternatives: sources.slice(1).map((source) => source.url),
        });
      }
    }

    // ─── Anime Routes ──────────────────────────────────────────────────────────
    if (pathname === '/api/anime/search') {
      const q = searchParams.get('q') || searchParams.get('query') || 'naruto';
      const page = searchParams.get('page') || '1';
      try {
        const data = await upstreamJson(`${JIKAN_BASE}/anime?q=${encodeURIComponent(q)}&page=${encodeURIComponent(page)}&sfw`);
        json(res, 200, {
          results: (data.data || []).map((anime) => ({
            mal_id: anime.mal_id,
            title: anime.title,
            title_english: anime.title_english,
            synopsis: anime.synopsis,
            image: anime.images?.jpg?.large_image_url,
            score: anime.score,
            episodes: anime.episodes,
            status: anime.status,
            genres: (anime.genres || []).map((genre) => genre.name),
            type: anime.type,
            year: anime.year,
            season: anime.season,
          })),
          pagination: data.pagination,
          source: 'jikan',
        });
      } catch {
        json(res, 200, {
          results: [],
          pagination: { current_page: Number(page) || 1, has_next_page: false },
          source: 'jikan',
          warning: 'Jikan anime search is currently unavailable',
        });
      }
      return true;
    }

    if (pathname === '/api/anime/stream') {
      const malId = searchParams.get('mal_id');
      const episode = searchParams.get('episode') || '1';
      const language = (searchParams.get('lang') || 'sub').toLowerCase();
      if (malId) {
        const safeMalId = encodeURIComponent(malId);
        const safeEpisode = encodeURIComponent(episode);
        const safeLanguage = encodeURIComponent(language);
        const sources = [
          { name: 'MegaPlay', url: `${MEGAPLAY_BASE}/mal/${safeMalId}/${safeEpisode}/${safeLanguage}` },
          { name: 'VidSrc', url: `${VIDSRC_BASE}/anime/${safeMalId}/${safeEpisode}` },
          { name: 'VidLink', url: `${VIDLINK_BASE}/anime/${safeMalId}?ep=${safeEpisode}&lang=${safeLanguage}` },
        ];
        json(res, 200, {
          sources,
          player: sources[0].url,
          embed: sources[2].url,
          alternatives: sources.slice(1).map((source) => source.url),
          note: 'MegaPlay by MAL ID with VidSrc and VidLink fallbacks.',
        });
        return true;
      }

      const animeTitle = searchParams.get('q') || searchParams.get('title');
      if (animeTitle) {
        const searchData = await upstreamJson(`${ANIKOTO_BASE}/search?q=${encodeURIComponent(animeTitle)}`).catch(() => ({ data: [] }));
        json(res, 200, {
          search_results: (searchData?.data || []).slice(0, 5),
          note: 'Pick a result and use its embed_id or mal_id to get stream URLs',
        });
        return true;
      }

      json(res, 400, { error: 'mal_id required' });
      return true;
    }

    if (pathname === '/api/anime/catalog') {
      const page = searchParams.get('page') || '1';
      const type = searchParams.get('type') || 'recent';
      const url = new URL('/catalog', ANIKOTO_BASE);
      url.searchParams.set('page', page);
      if (type === 'series') url.searchParams.set('type', 'series');
      const data = await upstreamJson(url.toString());
      json(res, 200, data);
      return true;
    }

    const animeSeriesParts = routeParams(pathname, '/api/anime/series');
    if (animeSeriesParts?.length === 1) {
      const data = await upstreamJson(`${ANIKOTO_BASE}/series/${encodeURIComponent(animeSeriesParts[0])}`);
      json(res, 200, data);
      return true;
    }

    if (pathname === '/api/trending/movies') {
      json(res, 200, { results: await trendingMovies(), source: 'omniget' });
      return true;
    }

    if (pathname === '/api/trending/tv') {
      json(res, 200, { results: await trendingTV(), source: 'omniget' });
      return true;
    }

    if (pathname === '/api/trending/anime') {
      json(res, 200, { results: await trendingAnime(), source: 'jikan' });
      return true;
    }

    if (pathname === '/api/trending/all' || pathname === '/api/homepage') {
      const [movies, tv, anime] = await Promise.allSettled([trendingMovies(), trendingTV(), trendingAnime()]);
      const payload = {
        movies: movies.status === 'fulfilled' ? movies.value.slice(0, 10) : [],
        tv: tv.status === 'fulfilled' ? tv.value.slice(0, 10) : [],
        anime: anime.status === 'fulfilled' ? anime.value.slice(0, 10) : [],
      };
      json(res, 200, pathname === '/api/homepage'
        ? { trending_movies: payload.movies, trending_tv: payload.tv, trending_anime: payload.anime }
        : payload);
      return true;
    }

    if (pathname === '/api/browse/movies' || pathname === '/api/browse/series') {
      const type = pathname.endsWith('/series') ? 'tv' : 'movie';
      const genre = searchParams.get('genre') || (type === 'tv' ? 'series' : 'action');
      const page = searchParams.get('page') || '1';
      const data = await searchOmnisave(genre, type, page);
      json(res, 200, normalizeMovieSearch(data));
      return true;
    }

    if (pathname === '/api/search/all') {
      const q = searchParams.get('q') || searchParams.get('query') || 'avengers';
      const [movies, tv, anime] = await Promise.allSettled([
        searchOmnisaveItems(q, 'movie'),
        searchOmnisaveItems(q, 'tv'),
        upstreamJson(`${JIKAN_BASE}/anime?q=${encodeURIComponent(q)}&limit=10&sfw`).catch(() => ({ data: [] })),
      ]);
      json(res, 200, {
        movies: movies.status === 'fulfilled' ? movies.value.slice(0, 10) : [],
        tv: tv.status === 'fulfilled' ? tv.value.slice(0, 10) : [],
        anime: anime.status === 'fulfilled' ? (anime.value.results || (anime.value.data || []).map((item) => normalizeAnimeSummary(item))).slice(0, 10) : [],
      });
      return true;
    }

    if (pathname === '/api/genres/movies') {
      json(res, 200, { genres: MOVIE_GENRES });
      return true;
    }

    if (pathname === '/api/genres/tv') {
      json(res, 200, { genres: TV_GENRES });
      return true;
    }

    if (pathname === '/api/genres/anime') {
      const data = await upstreamJson(`${JIKAN_BASE}/genres/anime`);
      json(res, 200, {
        genres: (data.data || []).map((genre) => ({
          mal_id: genre.mal_id,
          name: genre.name,
          count: genre.count,
        })),
      });
      return true;
    }

    if (pathname === '/api/seasonal/anime') {
      const now = new Date();
      const year = searchParams.get('year') || String(now.getFullYear());
      const seasons = ['winter', 'spring', 'summer', 'fall'];
      const season = (searchParams.get('season') || seasons[Math.floor(now.getMonth() / 3)]).toLowerCase();
      const data = await upstreamJson(`${JIKAN_BASE}/seasons/${encodeURIComponent(year)}/${encodeURIComponent(season)}`);
      json(res, 200, {
        season,
        year,
        results: (data.data || []).slice(0, 30).map((anime) => ({
          ...normalizeAnimeSummary(anime, { trimSynopsis: true }),
          studios: (anime.studios || []).map((studio) => studio.name),
          source: anime.source,
        })),
        pagination: data.pagination,
      });
      return true;
    }

    const recommendationParts = routeParams(pathname, '/api/recommendations/anime');
    if (recommendationParts?.length === 1) {
      const data = await upstreamJson(`${JIKAN_BASE}/anime/${encodeURIComponent(recommendationParts[0])}/recommendations`);
      json(res, 200, {
        recommendations: (data.data || []).slice(0, 15).map((rec) => ({
          mal_id: rec.entry?.mal_id,
          title: rec.entry?.title,
          image: rec.entry?.images?.jpg?.image_url || rec.entry?.images?.jpg?.large_image_url,
          url: rec.entry?.url,
          votes: rec.votes,
        })),
      });
      return true;
    }

    if (pathname === '/api/anime/random') {
      const data = await upstreamJson(`${JIKAN_BASE}/random/anime`);
      const anime = data.data;
      json(res, 200, anime ? normalizeAnimeSummary(anime) : { error: 'Not found' });
      return true;
    }

    if (pathname === '/api/latest/movies' || pathname === '/api/latest/tv') {
      const type = pathname.endsWith('/tv') ? 'tv' : 'movie';
      const year = new Date().getFullYear();
      const items = await searchOmnisaveItems(String(year), type);
      json(res, 200, { results: items.slice(0, 25), year });
      return true;
    }

    if (pathname === '/api/popular/movies') {
      const items = await collectOmnisaveSearches([
        { query: 'action', type: 'movie' },
        { query: 'comedy', type: 'movie' },
        { query: 'drama', type: 'movie' },
      ], 30);
      json(res, 200, { results: items });
      return true;
    }

    if (pathname === '/api/top/anime') {
      const page = searchParams.get('page') || '1';
      const data = await upstreamJson(`${JIKAN_BASE}/top/anime?page=${encodeURIComponent(page)}&limit=25`);
      json(res, 200, {
        results: (data.data || []).map((anime) => normalizeAnimeSummary(anime)),
        pagination: data.pagination,
      });
      return true;
    }

    if (pathname === '/api/upcoming/anime') {
      const data = await upstreamJson(`${JIKAN_BASE}/seasons/now?filter=tv&limit=25`);
      json(res, 200, {
        results: (data.data || []).map((anime) => normalizeAnimeSummary(anime, { trimSynopsis: true })),
      });
      return true;
    }

    const animeParts = routeParams(pathname, '/api/anime');
    if (animeParts?.length === 1) {
      if (!/^\d+$/.test(animeParts[0])) {
        json(res, 404, { error: 'Not Found' });
        return true;
      }
      const data = await upstreamJson(`${JIKAN_BASE}/anime/${encodeURIComponent(animeParts[0])}/full`);
      if (!data.data) {
        json(res, 404, { error: 'Not found' });
        return true;
      }
      const anime = data.data;
      json(res, 200, {
        mal_id: anime.mal_id,
        title: anime.title,
        title_english: anime.title_english,
        title_japanese: anime.title_japanese,
        synopsis: anime.synopsis,
        background: anime.background,
        image: anime.images?.jpg?.large_image_url,
        trailer: anime.trailer?.url,
        score: anime.score,
        scored_by: anime.scored_by,
        rank: anime.rank,
        popularity: anime.popularity,
        episodes: anime.episodes,
        status: anime.status,
        airing: anime.airing,
        aired_from: anime.aired?.from,
        aired_to: anime.aired?.to,
        duration: anime.duration,
        rating: anime.rating,
        genres: (anime.genres || []).map((genre) => genre.name),
        studios: (anime.studios || []).map((studio) => studio.name),
        producers: (anime.producers || []).map((producer) => producer.name),
        type: anime.type,
        season: anime.season,
        year: anime.year,
        relations: (anime.relations || []).map((relation) => ({
          relation: relation.relation,
          entries: relation.entry?.map((entry) => ({ mal_id: entry.mal_id, name: entry.name, type: entry.type })),
        })),
        theme_openings: anime.theme?.openings || [],
        theme_endings: anime.theme?.endings || [],
      });
      return true;
    }

    if (animeParts?.length === 2 && animeParts[1] === 'episodes') {
      if (!/^\d+$/.test(animeParts[0])) {
        json(res, 404, { error: 'Not Found' });
        return true;
      }
      const page = searchParams.get('page') || '1';
      const data = await upstreamJson(`${JIKAN_BASE}/anime/${encodeURIComponent(animeParts[0])}/episodes?page=${encodeURIComponent(page)}`);
      json(res, 200, {
        episodes: (data.data || []).map((episode) => ({
          mal_id: episode.mal_id,
          title: episode.title,
          title_japanese: episode.title_japanese,
          episode_number: episode.mal_id,
          aired: episode.aired,
          synopsis: episode.synopsis,
          forum_url: episode.url,
        })),
        pagination: data.pagination,
      });
      return true;
    }

    if (animeParts?.length === 2 && animeParts[1] === 'characters') {
      if (!/^\d+$/.test(animeParts[0])) {
        json(res, 404, { error: 'Not Found' });
        return true;
      }
      const data = await upstreamJson(`${JIKAN_BASE}/anime/${encodeURIComponent(animeParts[0])}/characters`);
      json(res, 200, {
        characters: (data.data || []).slice(0, 30).map((item) => ({
          character: {
            mal_id: item.character?.mal_id,
            name: item.character?.name,
            image: item.character?.images?.jpg?.image_url,
            role: item.role,
          },
          voice_actors: (item.voice_actors || []).map((actor) => ({
            person: {
              mal_id: actor.person?.mal_id,
              name: actor.person?.name,
              image: actor.person?.images?.jpg?.image_url,
            },
            language: actor.language,
          })),
        })),
      });
      return true;
    }

    if (pathname === '/api/health') {
      json(res, 200, { status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
      return true;
    }

    // ─── Test routes ───────────────────────────────────────────────────────────
    if (pathname === '/api/ping') {
      await handlePing(req, res);
      return true;
    }

    if (pathname === '/api/omegatech/sports') {
      await handleOmegatech(searchParams, res);
      return true;
    }

    // ─── football-live-stream-api routes (PRIMARY sports source) ───────────
    if (pathname === '/api/livestream/matches') {
      const date = searchParams.get('date');
      const data = await fetchLivestream('/all-match', { date }, 60000, (d) => Array.isArray(d?.result) && d.result.length > 0); // 60s — live scores update, but never cache an empty/quota-exceeded response
      // CONFIRMED via real test: top-level key is `result`. Keeping the other
      // candidates as a defensive fallback costs nothing and protects against
      // the API ever changing this.
      const matches = data?.result || data?.matches || data?.data || (Array.isArray(data) ? data : []);
      json(res, 200, { success: Array.isArray(matches) && matches.length > 0, matches: Array.isArray(matches) ? matches : [] });
      return true;
    }

    if (pathname === '/api/livestream/link') {
      const id = searchParams.get('id');
      if (!id) { json(res, 400, { success: false, error: 'id required' }); return true; }
      const data = await fetchLivestream(`/link/${encodeURIComponent(id)}`, {}, 60000, (d) => !!d?.url); // only cache when there's an actual url
      json(res, 200, { success: !!data?.url, url: data?.url || null });
      return true;
    }

    // ─── football-highlights-api routes (real match data) ──────────────────
    if (pathname === '/api/highlightly/match-id') {
      const date = searchParams.get('date');
      const home = searchParams.get('home');
      const away = searchParams.get('away');
      const data = await fetchHighlightly('/matches', { date, homeTeamName: home, awayTeamName: away }, 300000); // 5min — a match's id never changes
      const match = data?.data?.[0] || null;
      json(res, 200, { success: !!match, match });
      return true;
    }

    if (pathname === '/api/highlightly/lineups') {
      const matchId = searchParams.get('matchId');
      if (!matchId) { json(res, 400, { success: false, error: 'matchId required' }); return true; }
      const data = await fetchHighlightly(`/lineups/${encodeURIComponent(matchId)}`, {}, 300000); // 5min — lineups don't change once announced
      json(res, 200, { success: !!data, homeTeam: data?.homeTeam || null, awayTeam: data?.awayTeam || null });
      return true;
    }

    if (pathname === '/api/highlightly/statistics') {
      const matchId = searchParams.get('matchId');
      if (!matchId) { json(res, 400, { success: false, error: 'matchId required' }); return true; }
      const data = await fetchHighlightly(`/statistics/${encodeURIComponent(matchId)}`, {}, 60000); // 60s — updates live during a match
      json(res, 200, { success: Array.isArray(data), statistics: Array.isArray(data) ? data : [] });
      return true;
    }

    if (pathname === '/api/highlightly/events') {
      const matchId = searchParams.get('matchId');
      if (!matchId) { json(res, 400, { success: false, error: 'matchId required' }); return true; }
      const data = await fetchHighlightly(`/events/${encodeURIComponent(matchId)}`, {}, 60000); // 60s — updates live during a match
      json(res, 200, { success: Array.isArray(data), events: Array.isArray(data) ? data : [] });
      return true;
    }

    if (pathname === '/api/highlightly/player') {
      const id = searchParams.get('id');
      if (!id) { json(res, 400, { success: false, error: 'id required' }); return true; }
      const [player, statistics] = await Promise.all([
        fetchHighlightly(`/players/${encodeURIComponent(id)}`, {}, 3600000), // 1h — player bio rarely changes
        fetchHighlightly(`/players/${encodeURIComponent(id)}/statistics`, {}, 3600000), // 1h — season stats update slowly
      ]);
      json(res, 200, { success: !!player, player: player || null, statistics: Array.isArray(statistics) ? statistics : [] });
      return true;
    }

    if (pathname === '/api/highlightly/leagues') {
      const data = await fetchHighlightly('/leagues', { limit: 1000 }, 86400000); // 24h — league list barely ever changes
      json(res, 200, { success: !!data, leagues: data?.data || [] });
      return true;
    }

    // CONFIRMED real endpoint via curl test: /standings?leagueId=X&season=Y
    // returns { groups: [{ name, standings: [...] }], league: {...} }.
    if (pathname === '/api/highlightly/standings') {
      const leagueId = searchParams.get('leagueId');
      const season = searchParams.get('season');
      if (!leagueId) { json(res, 400, { success: false, error: 'leagueId required' }); return true; }
      const data = await fetchHighlightly('/standings', { leagueId, season }, 300000); // 5min — table updates slowly outside matchdays
      json(res, 200, { success: !!data, standings: data || null });
      return true;
    }

    json(res, 404, { error: 'Not Found' });
    return true;
  } catch (error) {
    console.error('API request error:', error);
    // ✅ FIX: Prevent the "headers already sent" crash by checking before sending
    if (!res.headersSent) {
      json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' });
    } else {
      try { res.end(); } catch (e) {}
    }
    return true;
  }
}

module.exports = { handleApiRequest };

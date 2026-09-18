export interface SportMatch {
  id: string | number;
  home: string;
  away: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  league: string;
  round?: string;
  time?: string;
  // ISO date (YYYY-MM-DD) of the match — needed to look up the real match on
  // football-highlights-api, which requires date + team names to find the id.
  dateISO?: string;
  status: string;
  homeScore?: number;
  awayScore?: number;
  isLive?: boolean;
  streamUrl?: string | null;
  streams?: { name: string; url: string; quality?: string }[];
  periodScores?: any[];
  replay?: { title: string; url: string }[];
  highlights?: { title: string; url: string }[];
  _source?: 'omegatech' | 'railway' | 'sportsrc' | 'livestream';
}

export interface SportNewsItem {
  id: string;
  title: string;
  summary?: string;
  image?: string;
  source?: string;
  publishedAt?: string;
  url?: string;
}

export interface SportHighlightItem {
  id: string;
  title: string;
  videoUrl: string;
  thumbnail?: string;
  duration?: string;
}

export interface SportLeague {
  id: string;
  name: string;
  country?: string;
}

export interface SportDetail {
  stream_urls?: { name: string; url: string }[];
  download_url?: string | null;
  live_score?: string;
  ad_guard?: { note: string };
}

// ── APIs ──────────────────────────────────────────────────────────────────────
export const OMEGATECH_BASE = '/api/omegatech/sports';
export const PRIMARY_BASE = 'https://movie-webv3-production.up.railway.app/api/sports';
export const SPORTSRC_BASE = '/api/sportsrc/detail'; // our proxy

export const WHATSAPP_CHANNELS = [
  { name: 'Channel 1', url: 'https://whatsapp.com/channel/0029VbBWaQyCxoAx2YLzfu0a' },
  { name: 'Channel 2', url: 'https://whatsapp.com/channel/0029Vb8SjpH5Ejy51uMnBS2w' },
];

export const TELEGRAM_REPORT = 'https://t.me/VIOLETKINGDEV';

const WWE_STREAMS = [
  { name: 'RAW', url: 'https://www.dailymotion.com/embed/video/xabvvww' },
  { name: 'SmackDown', url: 'https://www.dailymotion.com/embed/video/xabvxtg' },
  { name: 'NXT', url: 'https://www.dailymotion.com/embed/video/xabvvpk' },
  { name: 'AEW', url: 'https://www.dailymotion.com/embed/video/xabskee' },
];

function getWWEMatches(): SportMatch[] {
  return WWE_STREAMS.map((stream, index) => ({
    id: `wwe-${index}`,
    home: stream.name,
    away: 'WWE',
    homeLogo: null,
    awayLogo: null,
    league: 'WWE',
    status: 'LIVE',
    isLive: true,
    streams: [{ name: stream.name, url: stream.url, quality: 'HD' }],
    streamUrl: stream.url,
    ad_guard_safe: true,
    homeScore: 0,
    awayScore: 0,
    score: '0 - 0',
    minute: 'Live',
    periodScores: [],
    replay: [],
    highlights: [],
  }));
}

// ─── Helper: Fetch Omegatech matches ────────────────────────────────────────
// PRIMARY SOURCE. Your own feed — confirmed it already returns matches across
// every status (live/upcoming/MatchEnded) in one response, complete with the
// real .m3u8 in playPath/playSource. No need to go anywhere else for the
// stream itself.
async function fetchOmegatechMatches(sport: string): Promise<SportMatch[]> {
  try {
    const res = await fetch(`${OMEGATECH_BASE}?sport=${encodeURIComponent(sport)}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.success) return [];
    const matches = data.matches || [];
    return matches.map(adaptOmegatechMatch);
  } catch {
    return [];
  }
}

// ─── Helper: Fetch Railway matches ──────────────────────────────────────────
// SECONDARY SOURCE. Only used to fill in matches Omegatech hasn't scraped/listed
// yet (Railway tends to have a bigger upcoming-fixtures list). Never overrides
// an Omegatech match, since Omegatech's stream is the one you actually want playing.
async function fetchPrimaryMatches(sport: string, q: string): Promise<SportMatch[]> {
  try {
    const url = `${PRIMARY_BASE}/matches?sport=${encodeURIComponent(sport)}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const matches = data.matches || data.data || [];
    return matches.map(adaptPrimaryMatch);
  } catch {
    return [];
  }
}

// ─── Main: getSportsMatches ──────────────────────────────────────────────────
// ─── PRIMARY: football-live-stream-api ──────────────────────────────────────
// Your own tested API: 50+ matches/day with team logos and a confirmed-working
// m3u8 link per match (fetched separately via getLivestreamLink/id). Used as
// the primary source for football; Omegatech + Railway are the fallback if
// this returns nothing (e.g. rate-limited, or a date it doesn't cover).
function adaptLivestreamMatch(m: any): SportMatch {
  const [homeScore, awayScore] = String(m.score || '0 - 0').split(' - ').map((s: string) => parseInt(s, 10) || 0);
  // CONFIRMED via real samples: status is exactly "Live" / "Upcoming" / "Finished".
  // `currentMinutes` looked like it might signal live matches, but it's `null`
  // on every sample regardless of actual status — including confirmed live
  // matches — so it's not a usable signal at all. Reading `status` directly instead.
  const rawStatus = String(m.status || '').toLowerCase();
  const isFinished = rawStatus === 'finished';
  const isLive = rawStatus === 'live';
  const status = isFinished ? 'FINISHED' : isLive ? 'LIVE' : 'UPCOMING';
  const kickoff = m.kickoff ? new Date(m.kickoff) : null;

  return {
    id: m.id,
    home: m.home_name || 'Home',
    away: m.away_name || 'Away',
    homeLogo: m.home_flag || null,
    awayLogo: m.away_flag || null,
    league: m.league || 'Football',
    status,
    isLive,
    time: kickoff ? kickoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (m.time || undefined),
    dateISO: kickoff ? kickoff.toISOString().slice(0, 10) : m.date,
    homeScore,
    awayScore,
    streamUrl: null, // fetched lazily via getLivestreamLink when the user taps play
    streams: [],
    _source: 'livestream',
  };
}

async function fetchLivestreamMatches(date?: string): Promise<SportMatch[]> {
  try {
    const d = date || new Date().toISOString().slice(0, 10);
    const res = await fetch(`/api/livestream/matches?date=${encodeURIComponent(d)}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.success) return [];
    return (data.matches || []).map(adaptLivestreamMatch);
  } catch {
    return [];
  }
}

export async function getLivestreamLink(id: string | number): Promise<string | null> {
  try {
    const res = await fetch(`/api/livestream/link?id=${encodeURIComponent(String(id))}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data.url : null;
  } catch {
    return null;
  }
}

export async function getSportsMatches(category = 'football', q = ''): Promise<SportMatch[]> {
  // Per explicit request: the primary API (your football-live-stream-api) is
  // authoritative on its own when it's working — it is NOT merged with
  // Omegatech/Railway every time. Omegatech + Railway are a full fallback,
  // only reached when the primary genuinely has nothing at all (daily quota
  // exceeded, temporarily down, etc.).
  if (category === 'football' || category === 'all') {
    const liveStreamMatches = await fetchLivestreamMatches();
    if (liveStreamMatches.length > 0) {
      return q
        ? liveStreamMatches.filter(m => `${m.home} ${m.away} ${m.league}`.toLowerCase().includes(q.toLowerCase()))
        : liveStreamMatches;
    }
  }

  // FALLBACK (only reached if the primary returned nothing): Omegatech +
  // Railway, merged between themselves the same way as before. Kept
  // order-independent so "England vs Argentina" / "Argentina vs England"
  // (reversed home/away between these two) are recognized as one match.
  const omegatechMatches = await fetchOmegatechMatches(category);
  const railwayMatches = await fetchPrimaryMatches(category, q);

  const key = (home: string, away: string) => [home.toLowerCase(), away.toLowerCase()].sort().join('-');
  const seen = new Set(omegatechMatches.map(m => key(m.home, m.away)));
  const extra = railwayMatches.filter(m => !seen.has(key(m.home, m.away)));

  const merged = [...omegatechMatches, ...extra];

  return q
    ? merged.filter(m => `${m.home} ${m.away} ${m.league}`.toLowerCase().includes(q.toLowerCase()))
    : merged;
}

// ─── Get every stream candidate for a match (Primary → Omegatech → SportsRC) ─
// BUG FIX: the old getSportsStream() stopped at the FIRST source that
// returned a URL and threw the rest away. That's exactly what you were
// hitting: the primary livestream link came back, got attached to the
// <video>, and if THAT particular feed happened to be a black/broken/ad
// slate (common with scraped sources), there was nowhere left to go — the
// "STREAM" switcher in the UI had nothing in it because match.streams was
// never populated with the other sources that were available the whole
// time. This collects every candidate instead of bailing early, so the
// player always has real alternates to fall back to.
export async function getAllSportsStreams(match: SportMatch, sport = 'football'): Promise<{ name: string; url: string }[]> {
  const candidates: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string, url: string | null | undefined) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ name, url });
  };

  // PRIMARY: your football-live-stream-api — confirmed via your own test to
  // return a direct, working m3u8 for a given match id.
  if (match._source === 'livestream') {
    try {
      const url = await getLivestreamLink(match.id);
      push('Primary', url);
    } catch {}
  }

  // Whatever stream URL/list is already attached to the match object from
  // getSportsMatches() — cheap, no extra network round-trip needed.
  push('Direct', match.streamUrl);
  (match.streams || []).forEach((s, i) => push(s.name || `Mirror ${i + 1}`, s.url));

  // Omegatech (re-fetch list and find by team names) — fallback only
  try {
    const res = await fetch(`${OMEGATECH_BASE}?sport=${encodeURIComponent(sport)}`);
    if (res.ok) {
      const data = await res.json();
      const omegatechMatches = data.matches || [];
      const found = omegatechMatches.find((m: any) =>
        m.team1?.name === match.home && m.team2?.name === match.away
      );
      if (found) {
        push('Omegatech', found.playPath);
        (found.playSource || []).forEach((s: any, i: number) => push(`Omegatech ${i + 1}`, s.path));
      }
    }
  } catch {}

  // SportsRC (by title) — last resort, returns an embed page rather than a
  // direct .m3u8, but it's better than nothing when everything else is dead.
  try {
    const title = `${match.home} vs ${match.away}`;
    const listRes = await fetch(`https://api.sportsrc.org/?data=matches&category=${encodeURIComponent(sport)}`);
    if (listRes.ok) {
      const listData = await listRes.json();
      const found = listData.data?.find((m: any) => m.title === title);
      if (found) {
        const detailRes = await fetch(`${SPORTSRC_BASE}?id=${encodeURIComponent(found.id)}&category=${encodeURIComponent(sport)}`);
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          const sources = detailData.data?.sources || [];
          sources.forEach((s: any, i: number) => push(s.hd ? 'SportsRC HD' : `SportsRC ${i + 1}`, s.embedUrl));
        }
      }
    }
  } catch {}

  return candidates;
}

// ─── Get a single stream for a match (kept for any other existing callers) ──
export async function getSportsStream(match: SportMatch, sport = 'football'): Promise<string | null> {
  const all = await getAllSportsStreams(match, sport);
  return all.length > 0 ? all[0].url : null;
}

// ─── Adapter functions ────────────────────────────────────────────────────────
function adaptOmegatechMatch(m: any): SportMatch {
  // CONFIRMED against real data: status is one of exactly three strings —
  // "MatchNotStart" (upcoming), "MatchIng" (live), "MatchEnded" (finished).
  const isUpcoming = m.status === 'MatchNotStart';
  const isLive = m.status === 'MatchIng';
  const isEnded = m.status === 'MatchEnded';

  // startTime is epoch milliseconds as a string, e.g. "1783710000000".
  const startMs = m.startTime ? Number(m.startTime) : null;
  const time = startMs
    ? new Date(startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : undefined;
  const dateISO = startMs ? new Date(startMs).toISOString().slice(0, 10) : undefined;

  return {
    id: m.id,
    home: m.team1?.name || 'Home',
    away: m.team2?.name || 'Away',
    homeLogo: m.team1?.avatar || null,
    awayLogo: m.team2?.avatar || null,
    league: m.league || 'Sports',
    round: m.matchRound || undefined,
    status: isLive ? 'LIVE' : isEnded ? 'FINISHED' : 'UPCOMING',
    isLive,
    time,
    dateISO,
    homeScore: parseInt(m.team1?.score || '0'),
    awayScore: parseInt(m.team2?.score || '0'),
    streams: (m.playSource || []).map((s: any) => ({
      name: s.title || 'Stream',
      url: s.path,
      quality: 'HD',
    })),
    streamUrl: m.playPath || (m.playSource?.[0]?.path ?? null),
    replay: (m.replay || []).map((r: any) => ({ title: r.title, url: r.path })),
    highlights: (m.highlights || []).map((h: any) => ({ title: h.title, url: h.path })),
    _source: 'omegatech',
  };
}

// Railway's logo field is a RELATIVE path off its own domain, e.g.
// "/api/sports/logo-proxy?url=...". A relative path means nothing to a mobile
// <Image> component (there's no "current page" to resolve it against), so it
// was silently failing to load — this is the actual cause of "finished matches
// not loading with photo" (and it affects live/upcoming Railway matches too,
// though those happened to also come from Omegatech which uses full URLs).
function resolveRailwayLogo(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${PRIMARY_BASE.replace(/\/api\/sports$/, '')}${path}`;
}

function adaptPrimaryMatch(m: any): SportMatch {
  // Railway already returns a clean status enum directly — "LIVE" / "UPCOMING" / "FINISHED" —
  // and a real ISO startTime, so no guessing/fallback chains needed here.
  const status = String(m.status || 'UNKNOWN').toUpperCase();
  const time = m.startTime
    ? new Date(m.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : undefined;
  const dateISO = m.startTime ? new Date(m.startTime).toISOString().slice(0, 10) : undefined;

  return {
    id: m.id,
    home: m.homeTeam || 'Home',
    away: m.awayTeam || 'Away',
    homeLogo: resolveRailwayLogo(m.homeTeamLogo),
    awayLogo: resolveRailwayLogo(m.awayTeamLogo),
    league: m.league || 'Sports',
    status,
    isLive: status === 'LIVE',
    time,
    dateISO,
    homeScore: Number(m.homeScore) || 0,
    awayScore: Number(m.awayScore) || 0,
    streamUrl: null,
    streams: [],
    _source: 'railway',
  };
}

// ─── News, Highlights, etc. (keep as before) ─────────────────────────────────
export async function getSportsList() {
  return ['Football', 'Basketball', 'Tennis', 'Cricket', 'WWE'];
}

export async function getSportsLeagues() {
  return [
    { id: 'fifa', name: 'FIFA World Cup', country: 'International' },
    { id: 'ucl', name: 'Champions League', country: 'Europe' },
  ];
}

export async function getSportsNews(sport = 'football'): Promise<SportNewsItem[]> {
  try {
    const res = await fetch('/api/skysports/news');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.news && data.news.length > 0) {
        return data.news;
      }
    }
  } catch (e) {
    console.warn('Sky Sports proxy failed, falling back to Omegatech:', e);
  }

  try {
    const url = `${OMEGATECH_BASE}?sport=${sport.toLowerCase()}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      // Same fix as highlights: prefer a top-level `data.news` if present, but
      // don't assume it's there — the confirmed payload shape only guarantees
      // `totalNews` as a count plus a `matches` array.
      const items: any[] = Array.isArray(data.news) ? data.news : [];
      if (items.length > 0) {
        return items.map((n: any) => ({
          id: n.id || String(Math.random()),
          title: n.title || 'News Update',
          summary: n.summary || '',
          image: n.cover?.url || n.image || null,
          source: n.source || 'Omegatech',
          publishedAt: n.publishedAt || new Date().toISOString(),
          url: n.url || '#'
        }));
      }
    }
  } catch (e) {
    console.warn('Failed to fetch sports news');
  }

  return [];
}

export async function getSportsHighlights(sport = 'football'): Promise<SportHighlightItem[]> {
  try {
    const url = `${OMEGATECH_BASE}?sport=${sport.toLowerCase()}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();

      const toItem = (h: any): SportHighlightItem => ({
        id: h.id || String(Math.random()),
        title: h.title || 'Highlight',
        videoUrl: h.path || '',
        thumbnail: h.cover?.url || null,
        duration: h.duration || '0',
      });

      // BUG FIX: the old code only ever looked at a top-level `data.highlights`
      // array. In a real response, highlights actually live nested inside each
      // match (`data.matches[i].highlights`) — the top-level field either doesn't
      // exist or is a different shape, so this silently returned [] or stale data.
      // Collect from both places and de-dupe by id so nothing is missed or repeated.
      const topLevel: any[] = Array.isArray(data.highlights) ? data.highlights : [];
      const nested: any[] = (data.matches || []).flatMap((m: any) => m.highlights || []);

      const seen = new Set<string>();
      const combined: SportHighlightItem[] = [];
      for (const h of [...topLevel, ...nested]) {
        const item = toItem(h);
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        combined.push(item);
      }
      return combined;
    }
  } catch (e) {
    console.warn('Failed to fetch sports highlights');
  }
  return [];
}

export async function getSportsDetail(id: string | number, category = 'football'): Promise<SportDetail> {
  try {
    const url = `${OMEGATECH_BASE}?id=${id}&sport=${category}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const match = data.matches?.[0];
      if (match?.playSource) {
        return {
          stream_urls: match.playSource.slice(0, 3).map((s: any, i: number) => ({
            name: s.title || `Stream ${i + 1}`,
            url: s.path || '',
          })),
        };
      }
    }
  } catch (_) {}

  return { stream_urls: [] };
}

// ─── Real Match Center data (football-highlights-api via RapidAPI) ─────────
// NOTE: this is a genuinely different data source from Omegatech/Railway
// (which only give scores/streams). It requires knowing the match's date +
// exact team names to find the corresponding match id there — the two
// systems don't share ids. Anything here can come back null/empty if this
// API doesn't have the match (e.g. lower-league or very recent fixtures);
// callers should treat missing data as "not available" rather than an error.

export type HighlightlyPlayer = { id: number; name: string; number: number; position: string };
export type HighlightlyTeamLineup = {
  formation: string;
  initialLineup: HighlightlyPlayer[][]; // grouped by tactical row: [GK], [DEF...], [MID...], [FWD...]
  substitutes: HighlightlyPlayer[];
  id: number;
  logo: string | null;
  name: string;
};
export type HighlightlyStatRow = { displayName: string; value: number };
export type HighlightlyTeamStats = { team: { id: number; name: string; logo: string | null }; statistics: HighlightlyStatRow[] };
export type HighlightlyEvent = {
  team: { id: number; name: string; logo: string | null };
  time: string; // e.g. "10", "90+5" — a string, not a number, because of stoppage time
  type: 'Goal' | 'Yellow Card' | 'Red Card' | 'Substitution' | string;
  player: string; // flat name string — NOT a nested object
  assist: string | null; // assist provider's name, for Goal events
  substituted: string | null; // player going OFF, for Substitution events (the `player` field is who comes ON)
  playerId: number;
  assistingPlayerId: number | null;
};

export async function getHighlightlyMatchId(home: string, away: string, dateISO: string): Promise<{ id: number; state: any } | null> {
  try {
    const url = `/api/highlightly/match-id?date=${encodeURIComponent(dateISO)}&home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.success && data.match) return { id: data.match.id, state: data.match.state };
    return null;
  } catch {
    return null;
  }
}

export async function getMatchLineups(matchId: number | string): Promise<{ home: HighlightlyTeamLineup; away: HighlightlyTeamLineup } | null> {
  try {
    const res = await fetch(`/api/highlightly/lineups?matchId=${encodeURIComponent(String(matchId))}`);
    const data = await res.json();
    if (data.success && data.homeTeam && data.awayTeam) {
      return { home: data.homeTeam, away: data.awayTeam };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getMatchStatistics(matchId: number | string): Promise<HighlightlyTeamStats[]> {
  try {
    const res = await fetch(`/api/highlightly/statistics?matchId=${encodeURIComponent(String(matchId))}`);
    const data = await res.json();
    return data.success ? data.statistics : [];
  } catch {
    return [];
  }
}

export async function getMatchEvents(matchId: number | string): Promise<HighlightlyEvent[]> {
  try {
    const res = await fetch(`/api/highlightly/events?matchId=${encodeURIComponent(String(matchId))}`);
    const data = await res.json();
    return data.success ? data.events : [];
  } catch {
    return [];
  }
}

export async function getPlayerDetail(id: number | string): Promise<{ player: any; statistics: any[] } | null> {
  try {
    const res = await fetch(`/api/highlightly/player?id=${encodeURIComponent(String(id))}`);
    const data = await res.json();
    if (data.success) return { player: data.player, statistics: data.statistics };
    return null;
  } catch {
    return null;
  }
}

// League name -> id map, built once from the real (tested) /leagues endpoint.
export async function fetchLeagues(): Promise<{ id: number; name: string; logo: string | null; seasons: { season: number }[] }[]> {
  try {
    const res = await fetch('/api/highlightly/leagues');
    const data = await res.json();
    return data.success ? data.leagues : [];
  } catch {
    return [];
  }
}

// CONFIRMED via real curl test: returns { groups: [{ name, standings: [...] }], league: {...} }.
// Each standings row has team/points/position at the top level, but
// games/wins/draws/loses are nested under row.total (not top-level).
export async function getStandings(leagueId: string | number, season: string | number): Promise<any | null> {
  try {
    const res = await fetch(`/api/highlightly/standings?leagueId=${encodeURIComponent(String(leagueId))}&season=${encodeURIComponent(String(season))}`);
    const data = await res.json();
    return data.success ? data.standings : null;
  } catch {
    return null;
  }
}

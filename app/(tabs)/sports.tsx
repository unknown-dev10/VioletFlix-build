import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Linking, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import HlsVideoPlayer from '@/components/ui/HlsVideoPlayer';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSizes, FontWeights, Radii, Spacing } from '@/constants/theme';
import {
  getSportsMatches,
  getSportsStream,
  getAllSportsStreams,
  getSportsNews,
  getSportsHighlights,
  getHighlightlyMatchId,
  getMatchLineups,
  getMatchStatistics,
  getMatchEvents,
  fetchLeagues,
  getStandings,
  WHATSAPP_CHANNELS,
  TELEGRAM_REPORT,
  type SportMatch,
  type SportNewsItem,
  type SportHighlightItem,
  type HighlightlyTeamLineup,
  type HighlightlyTeamStats,
  type HighlightlyEvent,
} from '@/services/sportsService';

// Theme Colors
const VIOLET = '#8A2BE2';
const CYAN = '#00E5FF';
const LIVE_RED = '#FF4444';
const BG_DARK = '#121212';

export default function SportsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedSport, setSelectedSport] = useState('football');
  const [matches, setMatches] = useState<SportMatch[]>([]);
  const [news, setNews] = useState<SportNewsItem[]>([]);
  const [highlights, setHighlights] = useState<SportHighlightItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMatch, setSelectedMatch] = useState<SportMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingNews, setLoadingNews] = useState(false);
  const [loadingHighlights, setLoadingHighlights] = useState(false);

  // Player State
  const [activeStream, setActiveStream] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  // BUG FIX: previously only one stream URL was ever fetched, so if that
  // single feed was black/broken there was nothing left to try — the
  // "STREAM" switcher had no real alternates in it. Now we keep the full
  // ordered list of candidates and an index into it, so a playback failure
  // can automatically advance to the next real source instead of just
  // showing an error on a dead feed.
  const [streamCandidates, setStreamCandidates] = useState<{ name: string; url: string }[]>([]);
  const [streamIndex, setStreamIndex] = useState(0);
  const [videoModalVisible, setVideoModalVisible] = useState(false);
  const [statsModalVisible, setStatsModalVisible] = useState(false);
  const [statsTab, setStatsTab] = useState('statistics');

  // Match Center (real data via football-highlights-api)
  const [matchCenterId, setMatchCenterId] = useState<number | null>(null);
  const [matchCenterLoading, setMatchCenterLoading] = useState(false);
  const [matchCenterError, setMatchCenterError] = useState<string | null>(null);
  const [matchStatistics, setMatchStatistics] = useState<HighlightlyTeamStats[]>([]);
  const [matchLineups, setMatchLineups] = useState<{ home: HighlightlyTeamLineup; away: HighlightlyTeamLineup } | null>(null);
  const [matchEvents, setMatchEvents] = useState<HighlightlyEvent[]>([]);
  const [lineupTeamSide, setLineupTeamSide] = useState<'home' | 'away'>('home');
  const [lineupViewMode, setLineupViewMode] = useState<'formation' | 'list'>('formation');

  // Standings — league name -> id map (built once from the real, tested
  // /leagues endpoint), plus the currently-loaded table for whichever match
  // is open in Match Details.
  const [leagueIdMap, setLeagueIdMap] = useState<Record<string, { id: string; seasons: number[]; logo: string | null }>>({});

  // Omegatech and Highlightly don't always name the same league identically —
  // e.g. Omegatech says "FIFA World Cup", Highlightly's /leagues list just
  // has "World Cup". This was the actual cause of standings coming back
  // empty: exact string matching silently found nothing. Normalize both
  // sides and try a few reasonable variants before giving up.
  const findLeagueInfo = useCallback((name: string) => {
    if (!name) return null;
    if (leagueIdMap[name]) return leagueIdMap[name];
    const normalize = (s: string) => s.toLowerCase().replace(/^(fifa|uefa|conmebol|concacaf|caf|afc)\s+/i, '').trim();
    const target = normalize(name);
    const aliasMatch = Object.entries(leagueIdMap).find(([key]) => normalize(key) === target);
    return aliasMatch ? aliasMatch[1] : null;
  }, [leagueIdMap]);
  const [standingsGroups, setStandingsGroups] = useState<any[] | null>(null);
  const [standingsSeason, setStandingsSeason] = useState<number | null>(null);
  const [standingsSeasonOptions, setStandingsSeasonOptions] = useState<number[]>([]);
  const [standingsLeagueId, setStandingsLeagueId] = useState<string | null>(null);
  const [standingsLeagueName, setStandingsLeagueName] = useState<string | null>(null);
  const [standingsLeagueLogo, setStandingsLeagueLogo] = useState<string | null>(null);
  const [showSeasonPicker, setShowSeasonPicker] = useState(false);
  const [standingsLoading, setStandingsLoading] = useState(false);

  // "2025" -> "2025/26" (football seasons are named after the year they
  // start in and span into the following year).
  const formatSeason = (year: number) => `${year}/${String(year + 1).slice(2)}`;

  // Lineups come from a different provider than the match list itself (matched
  // by team name + date), so an occasional wrong/partial match can return a
  // malformed team object — e.g. a logo URL sitting in the `name` field
  // instead of a real team name. Never trust it blindly: fall back to the
  // team name we already know is correct from our own match data.
  const looksLikeUrl = (s: any) => typeof s === 'string' && (s.includes('://') || s.includes('.net/') || s.includes('.com/'));
  const safeTeamName = (apiName: any, fallback: string) => (apiName && !looksLikeUrl(apiName) ? apiName : fallback);
  const safeFormation = (formation: any) => (formation && !looksLikeUrl(formation) ? formation : null);

  const loadStandings = useCallback(async (leagueId: string, season: number) => {
    setStandingsLoading(true);
    setStandingsSeason(season);
    try {
      const data = await getStandings(leagueId, season);
      // CONFIRMED via real curl test: `data.groups` is an array of
      // { name, standings: [...] }.
      setStandingsGroups(Array.isArray(data?.groups) ? data.groups : null);
    } catch {
      setStandingsGroups(null);
    } finally {
      setStandingsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeagues().then((leagues) => {
      const map: Record<string, { id: string; seasons: number[]; logo: string | null }> = {};
      leagues.forEach((league: any) => {
        const seasons = (league.seasons || []).map((s: any) => s.season).filter(Boolean);
        map[league.name] = { id: String(league.id), seasons, logo: league.logo || null };
      });
      setLeagueIdMap(map);
    });
  }, []);

  const openMatchCenter = useCallback(async (match: SportMatch) => {
    setSelectedMatch(match);
    setStatsModalVisible(true);
    setStatsTab('statistics');
    setLineupTeamSide('home');
    setMatchCenterId(null);
    setMatchStatistics([]);
    setMatchLineups(null);
    setMatchEvents([]);
    setMatchCenterError(null);
    setStandingsGroups(null);
    setStandingsSeason(null);
    setStandingsSeasonOptions([]);
    setStandingsLeagueId(null);
    setStandingsLeagueName(null);
    setStandingsLeagueLogo(null);

    // Standings only need the league (not the specific match), so this runs
    // independently — it can succeed even if the match-id lookup below fails.
    // Per spec: always show the CURRENT live table for that league — not the
    // season the tapped match happened to be played in (an old finished match
    // should still show today's standings, not a historical table).
    const leagueInfo = findLeagueInfo(match.league);
    if (leagueInfo) {
      const currentYear = new Date().getFullYear();
      const sortedSeasons = [...leagueInfo.seasons].sort((a, b) => b - a);
      const season = sortedSeasons.includes(currentYear) ? currentYear : sortedSeasons[0];
      setStandingsLeagueId(leagueInfo.id);
      setStandingsLeagueName(match.league);
      setStandingsLeagueLogo(leagueInfo.logo);
      setStandingsSeasonOptions(sortedSeasons);
      if (season) loadStandings(leagueInfo.id, season);
    }

    if (!match.dateISO) {
      setMatchCenterError('No match date available to look this game up.');
      return;
    }
    setMatchCenterLoading(true);
    try {
      const found = await getHighlightlyMatchId(match.home, match.away, match.dateISO);
      if (!found) {
        setMatchCenterError('Match details are not available for this game yet.');
        return;
      }
      setMatchCenterId(found.id);
      const [stats, lineups, events] = await Promise.all([
        getMatchStatistics(found.id),
        getMatchLineups(found.id),
        getMatchEvents(found.id),
      ]);
      setMatchStatistics(stats);
      setMatchLineups(lineups);
      setMatchEvents(events);
    } catch {
      setMatchCenterError('Could not load match details right now.');
    } finally {
      setMatchCenterLoading(false);
    }
  }, [findLeagueInfo, loadStandings]);

  // Load matches (combined)
  const loadMatches = useCallback(async (category: string, query = searchQuery) => {
    setLoading(true);
    setError(null);
    setMatches([]);
    setNews([]);
    setHighlights([]);
    try {
      if (category.toLowerCase() === 'sportsnews') {
        setLoadingNews(true);
        const newsData = await getSportsNews('football');
        setNews(newsData);
      } else if (category.toLowerCase() === 'highlights') {
        setLoadingHighlights(true);
        const highlightData = await getSportsHighlights('football');
        setHighlights(highlightData);
      } else {
        const allMatches = await getSportsMatches(category, query.trim());
        setMatches(allMatches);
      }
    } catch (err: any) {
      setError(err.message || 'Unable to load content.');
    } finally {
      setLoading(false);
      setLoadingNews(false);
      setLoadingHighlights(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    loadMatches(selectedSport);
  }, [selectedSport, loadMatches]);

  // Group matches
  const liveMatches = matches.filter(m => m.isLive);
  const upcomingMatches = matches.filter(m => !m.isLive && m.status?.toLowerCase() !== 'finished');
  const finishedMatches = matches.filter(m => m.status?.toLowerCase() === 'finished');

  // ─── Stream player ──────────────────────────────────────────────────────────
  const openVideo = async (match: SportMatch) => {
    setSelectedMatch(match);
    setVideoModalVisible(true);
    setActiveStream(null);
    setStreamError(null);
    setStreamLoading(true);
    setStreamCandidates([]);
    setStreamIndex(0);

    try {
      // BUG FIX: this had no timeout at all — if the stream lookup (or the
      // underlying HLS attach) just hung, the user was stuck on "Loading
      // stream…" forever with no way out. Race it against a timeout so a
      // clear, retryable error shows up instead.
      // Bumped from 15s to 25s: the server side is confirmed working correctly
      // (verified via direct curl against the same endpoint/id), so a timeout
      // this short was likely too aggressive for a genuinely slow mobile
      // connection to complete even a small JSON fetch within.
      const timeout = new Promise<{ name: string; url: string }[]>((resolve) => setTimeout(() => resolve([]), 25000));
      const candidates = await Promise.race([getAllSportsStreams(match, selectedSport), timeout]);
      if (candidates.length > 0) {
        setStreamCandidates(candidates);
        setStreamIndex(0);
        setActiveStream(candidates[0].url);
        // Feed the real alternates into the match object so the existing
        // "STREAM" switcher row (which reads selectedMatch.streams) shows
        // actual working mirrors instead of staying empty.
        setSelectedMatch(prev => (prev ? { ...prev, streams: candidates } : prev));
      } else {
        setStreamError('Stream took too long to load, or is not available right now.');
      }
    } catch (err: any) {
      setStreamError(err?.message || 'Could not load the stream.');
    } finally {
      setStreamLoading(false);
    }
  };

  // BUG FIX: previously a playback error just showed a dead-end message.
  // Now, if there's another candidate left in the list, auto-advance to it
  // instead of leaving the user stuck on a black/broken feed with no real
  // way to recover other than manually noticing and tapping a mirror.
  const advanceToNextStream = useCallback((failedUrl: string) => {
    setStreamIndex(prevIndex => {
      const list = streamCandidates;
      const failedIdx = list.findIndex(c => c.url === failedUrl);
      const startFrom = failedIdx >= 0 ? failedIdx : prevIndex;
      const next = list[startFrom + 1];
      if (next) {
        setActiveStream(next.url);
        setStreamError(null);
        return startFrom + 1;
      }
      setStreamError('This stream failed to play. It may be offline.');
      return prevIndex;
    });
  }, [streamCandidates]);

  // A direct .m3u8 (your API's own stream) should always go through the native
  // <Video> player. Only route to the WebView when it's genuinely a hosted embed
  // *page* (no .m3u8 extension) — previously `.includes('embed')` could also
  // misfire on plain video URLs that happened to contain that substring.
  const isDirectStream = !!activeStream && /\.m3u8(\?|$)/i.test(activeStream);
  const isEmbedPage = !!activeStream && !isDirectStream && (
    activeStream.includes('embed.streamapi.cc') || activeStream.includes('/embed')
  );

  const renderSportsVideo = () => {
    if (streamLoading) {
      return (
        <View style={styles.emptyPlayer}>
          <ActivityIndicator color={VIOLET} />
          <Text style={{ color: '#aaa', marginTop: 8 }}>Loading stream…</Text>
        </View>
      );
    }

    if (streamError || !activeStream) {
      return (
        <View style={styles.emptyPlayer}>
          <MaterialIcons name="wifi-off" size={32} color="#666" style={{ marginBottom: 8 }} />
          <Text style={{ color: '#aaa', textAlign: 'center', paddingHorizontal: 24 }}>{streamError || 'No stream available'}</Text>
          {selectedMatch && (
            <Pressable style={styles.retryStreamBtn} onPress={() => openVideo(selectedMatch)}>
              <MaterialIcons name="refresh" size={18} color="#fff" />
              <Text style={styles.btnText}>Retry</Text>
            </Pressable>
          )}
        </View>
      );
    }

    if (isEmbedPage) {
      return (
        <WebView
          source={{ uri: activeStream }}
          style={styles.videoWebView}
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
          mixedContentMode="always"
          onError={() => activeStream && advanceToNextStream(activeStream)}
        />
      );
    }

    return (
      <HlsVideoPlayer
        uri={activeStream}
        style={styles.videoPlayer}
        onError={() => activeStream && advanceToNextStream(activeStream)}
      />
    );
  };

  // ─── UI Components ──────────────────────────────────────────────────────────
  const MatchCard = ({ match, type }: { match: SportMatch; type: 'live' | 'upcoming' | 'finished' }) => {
    const isLive = type === 'live';
    const isUpcoming = type === 'upcoming';
    return (
      <View style={styles.card}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardLeague}>{match.league}</Text>
          <View style={[styles.statusPill, isLive && styles.statusPillLive, !isLive && !isUpcoming && styles.statusPillFinished]}>
            <Text style={styles.statusText}>
              {isLive ? '● LIVE' : isUpcoming ? '𝕌ℙℂ𝕆𝕄𝕀ℕ𝔾' : '𝔽𝕀ℕ𝕀𝕊ℍ𝔼𝔻'}
            </Text>
          </View>
        </View>

        <View style={styles.cardMidRow}>
          <View style={styles.teamSide}>
            {match.homeLogo ? (
              <Image source={{ uri: match.homeLogo }} style={styles.teamLogo} />
            ) : (
              <View style={styles.fallbackLogo}><Text style={styles.fallbackText}>{match.home?.slice(0, 2)}</Text></View>
            )}
            <Text style={styles.teamName} numberOfLines={1}>{match.home}</Text>
          </View>

          <View style={styles.centerScoreArea}>
            {isLive ? (
              <Text style={styles.scoreText}>{match.homeScore ?? 0} : {match.awayScore ?? 0}</Text>
            ) : isUpcoming ? (
              <>
                <Text style={styles.upcomingTime}>{match.time || 'TBD'}</Text>
                <Text style={styles.upcomingRound}>{match.round || ''}</Text>
              </>
            ) : (
              <Text style={styles.scoreText}>{match.homeScore ?? 0} : {match.awayScore ?? 0}</Text>
            )}
          </View>

          <View style={styles.teamSide}>
            {match.awayLogo ? (
              <Image source={{ uri: match.awayLogo }} style={styles.teamLogo} />
            ) : (
              <View style={styles.fallbackLogo}><Text style={styles.fallbackText}>{match.away?.slice(0, 2)}</Text></View>
            )}
            <Text style={styles.teamName} numberOfLines={1}>{match.away}</Text>
          </View>
        </View>

        {/* BUG FIX: "Watch Live" used to also render for upcoming matches (isLive || isUpcoming).
            A match that hasn't started has no stream yet, so the button belongs on live matches only.
            Finished and upcoming matches still get a Match Details button — just without Watch Live. */}
        {match.league !== 'WWE' && (
          <View style={styles.cardBottomRow}>
            {isLive && (
              <Pressable style={styles.watchLiveBtn} onPress={() => openVideo(match)}>
                <MaterialIcons name="play-arrow" size={20} color="#fff" />
                <Text style={styles.btnText}>Watch Live</Text>
              </Pressable>
            )}
            <Pressable style={isLive ? styles.detailsBtn : styles.detailsBtnFull} onPress={() => openMatchCenter(match)}>
              <MaterialIcons name="bar-chart" size={20} color="#fff" />
              <Text style={styles.btnText}>Match Details</Text>
            </Pressable>
          </View>
        )}
        {match.league === 'WWE' && isLive && (
          <View style={styles.cardBottomRow}>
            <Pressable style={styles.watchLiveBtnFull} onPress={() => openVideo(match)}>
              <MaterialIcons name="play-arrow" size={20} color="#fff" />
              <Text style={styles.btnText}>Watch Live</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  // ============ NEWS CARD ============
  const NewsCard = ({ item }: { item: SportNewsItem }) => (
    <Pressable
      style={({ pressed }) => [styles.newsCard, pressed && { opacity: 0.9 }]}
      onPress={() => item.url && Linking.openURL(item.url)}
    >
      <View style={styles.newsImageWrapper}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.newsImage} contentFit="cover" />
        ) : (
          <View style={[styles.newsImage, styles.newsImageFallback]}>
            <MaterialIcons name="newspaper" size={40} color="#444" />
          </View>
        )}
        <View style={styles.trendingBadge}>
          <Text style={styles.trendingBadgeText}>TRENDING NEWS</Text>
        </View>
      </View>
      <View style={styles.newsContent}>
        <Text style={styles.newsDate}>
          {item.publishedAt
            ? new Date(item.publishedAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : 'Latest News'}
        </Text>
        <Text style={styles.newsTitle} numberOfLines={2}>{item.title}</Text>
        {item.summary && (
          <Text style={styles.newsSummary} numberOfLines={3}>{item.summary}</Text>
        )}
        <View style={styles.readMoreRow}>
          <Text style={styles.readMoreText}>READ FULL STORY</Text>
          <View style={styles.readMoreLine} />
        </View>
      </View>
    </Pressable>
  );

  // ============ HIGHLIGHT CARD ============
  const HighlightCard = ({ item }: { item: SportHighlightItem }) => (
    <Pressable style={styles.highlightCard} onPress={() => item.videoUrl && Linking.openURL(item.videoUrl)}>
      {item.thumbnail ? (
        <Image source={{ uri: item.thumbnail }} style={styles.highlightImage} />
      ) : (
        <View style={styles.highlightImageFallback}><MaterialIcons name="play-circle" size={32} color="#888" /></View>
      )}
      <View style={styles.highlightOverlay}>
        <MaterialIcons name="play-arrow" size={20} color="#fff" />
        <Text style={styles.highlightTitle} numberOfLines={1}>{item.title}</Text>
      </View>
    </Pressable>
  );

  // Sport Chips
  const sportChips = [
    { label: 'Football', icon: 'sports-soccer' },
    { label: 'Basketball', icon: 'sports-basketball' },
    null,
    { label: 'Sports News', icon: 'newspaper' },
    { label: 'WWE', icon: 'sports-martial-arts' },
    { label: 'Cricket', icon: 'sports-cricket' },
    { label: 'Highlights', icon: 'movie' },
    { label: 'Tennis', icon: 'sports-tennis' },
    { label: 'All Sports', icon: 'public' },
  ];

  // ====== STAT BAR COMPONENT ======
  const StatBar = ({ label, home, away, homePct, awayPct, suffix = '', colorHome, colorAway }: any) => (
    <View style={styles.statRow}>
      <View style={styles.statLabelRow}>
        <Text style={styles.statLabel}>{label}</Text>
        <View style={styles.statValues}>
          <Text style={[styles.statVal, { color: colorHome }]}>{home}{suffix}</Text>
          <Text style={[styles.statVal, { color: colorAway }]}>{away}{suffix}</Text>
        </View>
      </View>
      <View style={styles.statBarBg}>
        <View style={[styles.statBarFill, { width: `${homePct ?? home}%`, backgroundColor: colorHome }]} />
        <View style={[styles.statBarFill, { width: `${awayPct ?? away}%`, backgroundColor: colorAway, marginLeft: 1 }]} />
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Content — header/search/chips now scroll WITH the list instead of
          being pinned in a fixed View above it, which was eating up most of
          the screen and leaving barely any room to scroll through matches. */}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerGlassWrap}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={['rgba(0,229,255,0.10)', 'rgba(138,43,226,0.10)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              {Platform.OS === 'web' ? (
                // BUG FIX: MaskedView has no real web support in react-native-web
                // — that's exactly why the title rendered as plain solid black
                // text with no gradient at all. Since this app runs in the
                // browser, use the actual CSS gradient-text technique instead,
                // which every modern browser supports natively.
                <Text
                  style={[
                    styles.headerTitle,
                    {
                      backgroundImage: `linear-gradient(90deg, ${CYAN}, ${VIOLET})`,
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                    } as any,
                  ]}
                >
                  SPORT UPDATES
                </Text>
              ) : (
                <MaskedView maskElement={<Text style={styles.headerTitle}>SPORT UPDATES</Text>}>
                  <LinearGradient colors={[CYAN, VIOLET]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                    <Text style={[styles.headerTitle, { opacity: 0 }]}>SPORT UPDATES</Text>
                  </LinearGradient>
                </MaskedView>
              )}
              <Text style={styles.headerSub}>
                Live matches, breaking sport news, and match highlights powered by Violetkingdev.
              </Text>
            </View>
            <Pressable onPress={() => loadMatches(selectedSport)}>
              <LinearGradient colors={[VIOLET, '#C471ED']} style={styles.refreshButton}>
                <MaterialIcons name="refresh" size={20} color="#fff" />
              </LinearGradient>
            </Pressable>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchWrap}>
          <MaterialIcons name="search" size={18} color="#888" />
          <TextInput
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              loadMatches(selectedSport, text);
            }}
            placeholder="Search teams or leagues..."
            placeholderTextColor="#666"
            style={styles.searchInput}
            returnKeyType="search"
            onSubmitEditing={() => loadMatches(selectedSport, searchQuery)}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => { setSearchQuery(''); loadMatches(selectedSport, ''); }}>
              <MaterialIcons name="close" size={16} color="#888" />
            </Pressable>
          )}
        </View>

        {/* Sport Chips Grid */}
        <View style={styles.chipGrid}>
          {sportChips.map((chip, index) => {
            if (!chip) return <View key={index} style={{ width: '30%' }} />;
            const sportKey = chip.label === 'All Sports' ? 'all' : chip.label.toLowerCase().replace(/\s/g, '');
            const isActive = selectedSport === sportKey;
            return (
              <Pressable
                key={index}
                style={[styles.chipItem, isActive && styles.chipItemActive]}
                onPress={() => setSelectedSport(sportKey)}
              >
                <MaterialIcons name={chip.icon as any} size={16} color={isActive ? BG_DARK : '#fff'} />
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{chip.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {loading || loadingNews || loadingHighlights ? (
          <ActivityIndicator color={VIOLET} style={{ marginTop: 40 }} />
        ) : error ? (
          <Text style={styles.emptyText}>{error}</Text>
        ) : (
          <>
            {selectedSport !== 'sportsnews' && selectedSport !== 'highlights' && (
              <>
                {liveMatches.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>● LIVE</Text>
                    {liveMatches.map(m => <MatchCard key={m.id} match={m} type="live" />)}
                  </View>
                )}
                {upcomingMatches.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeaderRow}>
                      <View style={styles.sectionTitleWithBadge}>
                        <Text style={styles.sectionTitle}>𝕌ℙℂ𝕆𝕄𝕀ℕ𝔾</Text>
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{upcomingMatches.length}</Text>
                        </View>
                      </View>
                    </View>
                    {upcomingMatches.map(m => <MatchCard key={m.id} match={m} type="upcoming" />)}
                  </View>
                )}
                {finishedMatches.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeaderRow}>
                      <View style={styles.sectionTitleWithBadge}>
                        <Text style={styles.sectionTitle}>𝔽𝕀ℕ𝕀𝕊ℍ𝔼𝔻</Text>
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{finishedMatches.length}</Text>
                        </View>
                      </View>
                    </View>
                    {finishedMatches.map(m => <MatchCard key={m.id} match={m} type="finished" />)}
                  </View>
                )}
              </>
            )}
            {selectedSport === 'sportsnews' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📰 Sports News</Text>
                {news.length === 0 ? (
                  <Text style={styles.emptyText}>No news available right now.</Text>
                ) : (
                  news.map(item => <NewsCard key={item.id} item={item} />)
                )}
              </View>
            )}
            {selectedSport === 'highlights' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>🎬 Highlights</Text>
                {highlights.length === 0 ? (
                  <Text style={styles.emptyText}>No highlights available right now.</Text>
                ) : (
                  highlights.map(item => <HighlightCard key={item.id} item={item} />)
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Video Player Modal */}
      <Modal visible={videoModalVisible} animationType="slide" onRequestClose={() => setVideoModalVisible(false)}>
        <View style={[styles.videoRoot, { paddingTop: insets.top }]}>
          <View style={styles.videoHeader}>
            <Pressable onPress={() => setVideoModalVisible(false)}>
              <MaterialIcons name="arrow-back" size={24} color="#fff" />
            </Pressable>
            <View style={styles.videoTitleWrap}>
              <Text style={styles.videoTitle}>{selectedMatch?.home} vs {selectedMatch?.away}</Text>
              <Text style={styles.videoSub}>{selectedMatch?.league}</Text>
            </View>
            <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>● LIVE</Text></View>
            <MaterialIcons name="fullscreen" size={24} color="#fff" />
          </View>

          <View style={styles.videoContainer}>
            {renderSportsVideo()}
          </View>

          {/* Stream & Source controls */}
          <View style={styles.controlsRow}>
            <Text style={styles.controlLabel}>STREAM</Text>
            <View style={styles.streamGrid}>
              {(selectedMatch?.streams || []).slice(0, 3).map((s, i) => (
                <Pressable key={i} style={[styles.streamBtn, activeStream === s.url && styles.streamBtnActive]} onPress={() => setActiveStream(s.url)}>
                  <Text style={[styles.streamBtnText, activeStream === s.url && { color: BG_DARK }]}>{i + 1}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.controlsRow}>
            <Text style={styles.controlLabel}>SOURCE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {WHATSAPP_CHANNELS.map((ch, i) => (
                <Pressable key={i} style={styles.sourceBtn} onPress={() => Linking.openURL(ch.url)}>
                  <Text style={styles.sourceBtnText}>{ch.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <Pressable style={styles.reportRow} onPress={() => Linking.openURL(TELEGRAM_REPORT)}>
            <MaterialIcons name="warning" size={14} color="#888" />
            <Text style={styles.reportText}>Report stream issue</Text>
          </Pressable>

          <View style={styles.videoFooter}>
            <View style={styles.footerLeagueRow}>
              <Text style={styles.leagueText}>{selectedMatch?.league?.toUpperCase()}</Text>
              {selectedMatch?.isLive && (
                <View style={styles.footerLiveBadge}>
                  <View style={styles.footerLiveDot} />
                  <Text style={styles.footerLiveText}>LIVE</Text>
                </View>
              )}
            </View>
            <View style={styles.footerTeamRow}>
              {selectedMatch?.homeLogo ? (
                <Image source={{ uri: selectedMatch.homeLogo }} style={styles.footerLogo} />
              ) : (
                <View style={styles.footerLogoFallback}><Text style={styles.fallbackText}>{selectedMatch?.home?.slice(0, 2)}</Text></View>
              )}
              <Text style={styles.footerTeamName}>{selectedMatch?.home}</Text>
              <Text style={styles.footerScoreNum}>{selectedMatch?.homeScore ?? 0}</Text>
            </View>
            <Text style={styles.footerVs}>VS</Text>
            <View style={styles.footerTeamRow}>
              {selectedMatch?.awayLogo ? (
                <Image source={{ uri: selectedMatch.awayLogo }} style={styles.footerLogo} />
              ) : (
                <View style={styles.footerLogoFallback}><Text style={styles.fallbackText}>{selectedMatch?.away?.slice(0, 2)}</Text></View>
              )}
              <Text style={styles.footerTeamName}>{selectedMatch?.away}</Text>
              <Text style={styles.footerScoreNum}>{selectedMatch?.awayScore ?? 0}</Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Match Details Modal */}
      <Modal visible={statsModalVisible} animationType="slide" onRequestClose={() => setStatsModalVisible(false)}>
        <View style={[styles.videoRoot, { paddingTop: insets.top }]}>
          <View style={styles.videoHeader}>
            <Pressable onPress={() => setStatsModalVisible(false)}>
              <MaterialIcons name="arrow-back" size={24} color="#fff" />
            </Pressable>
            <Text style={styles.videoTitle}>Match Details</Text>
            <Pressable onPress={() => selectedMatch && openMatchCenter(selectedMatch)}>
              <MaterialIcons name="refresh" size={24} color="#fff" />
            </Pressable>
          </View>

          {/* Score header — always visible regardless of which tab is open */}
          <View style={styles.mcScoreHeader}>
            <View style={styles.mcTeamCol}>
              {selectedMatch?.homeLogo ? (
                <Image source={{ uri: selectedMatch.homeLogo }} style={styles.mcTeamLogo} />
              ) : (
                <View style={styles.fallbackLogo}><Text style={styles.fallbackText}>{selectedMatch?.home?.slice(0, 2)}</Text></View>
              )}
              <Text style={styles.mcTeamName} numberOfLines={1}>{selectedMatch?.home}</Text>
            </View>
            <View style={styles.mcScoreCol}>
              <Text style={styles.mcScoreText}>{selectedMatch?.homeScore ?? 0} : {selectedMatch?.awayScore ?? 0}</Text>
              {selectedMatch?.isLive && (
                <View style={styles.footerLiveBadge}><View style={styles.footerLiveDot} /><Text style={styles.footerLiveText}>LIVE</Text></View>
              )}
            </View>
            <View style={styles.mcTeamCol}>
              {selectedMatch?.awayLogo ? (
                <Image source={{ uri: selectedMatch.awayLogo }} style={styles.mcTeamLogo} />
              ) : (
                <View style={styles.fallbackLogo}><Text style={styles.fallbackText}>{selectedMatch?.away?.slice(0, 2)}</Text></View>
              )}
              <Text style={styles.mcTeamName} numberOfLines={1}>{selectedMatch?.away}</Text>
            </View>
          </View>

          <View style={styles.tabBar}>
            {['statistics', 'lineups', 'events', 'standings'].map(tab => (
              <Pressable key={tab} style={[styles.tabBtn, statsTab === tab && styles.tabBtnActive]} onPress={() => setStatsTab(tab)}>
                <Text style={[styles.tabText, statsTab === tab && styles.tabTextActive]}>{tab.toUpperCase()}</Text>
                {statsTab === tab && <View style={styles.tabIndicator} />}
              </Pressable>
            ))}
          </View>

          <ScrollView contentContainerStyle={{ padding: Spacing.md }}>
            {statsTab === 'standings' ? (
              !standingsLeagueId ? (
                <Text style={styles.emptyText}>Standings not available for this league.</Text>
              ) : (
                <View>
                  {/* League header + season dropdown */}
                  <View style={styles.standingsTopRow}>
                    <View style={styles.standingsLeagueHeader}>
                      {standingsLeagueLogo ? (
                        <Image source={{ uri: standingsLeagueLogo }} style={styles.standingsLeagueLogo} />
                      ) : (
                        <MaterialIcons name="emoji-events" size={22} color={VIOLET} />
                      )}
                      <Text style={styles.standingsLeagueName} numberOfLines={1}>{standingsLeagueName}</Text>
                    </View>
                    {standingsSeasonOptions.length > 1 && (
                      <Pressable style={styles.seasonDropdownBtn} onPress={() => setShowSeasonPicker(true)}>
                        <Text style={styles.seasonDropdownText}>{standingsSeason ? formatSeason(standingsSeason) : '—'}</Text>
                        <MaterialIcons name="arrow-drop-down" size={20} color="#fff" />
                      </Pressable>
                    )}
                  </View>

                  {standingsLoading ? (
                    <ActivityIndicator color={VIOLET} style={{ marginTop: 40 }} />
                  ) : standingsGroups && standingsGroups.length > 0 ? (
                    standingsGroups.map((group: any, gIdx: number) => (
                      <View key={gIdx} style={{ marginBottom: 24 }}>
                        {standingsGroups.length > 1 && (
                          <Text style={styles.standingsGroupTitle}>{group.name}</Text>
                        )}
                        <View style={styles.standingsHeaderRow}>
                          <Text style={[styles.standingsHeaderCell, { width: 22 }]}>#</Text>
                          <Text style={[styles.standingsHeaderCell, styles.standingsTeamHeaderCell]}>Team</Text>
                          <Text style={styles.standingsHeaderCell}>P</Text>
                          <Text style={styles.standingsHeaderCell}>W</Text>
                          <Text style={styles.standingsHeaderCell}>D</Text>
                          <Text style={styles.standingsHeaderCell}>L</Text>
                          <Text style={[styles.standingsHeaderCell, { width: 52 }]}>Goals</Text>
                          <Text style={styles.standingsHeaderCell}>GD</Text>
                          <Text style={styles.standingsHeaderCell}>Pts</Text>
                        </View>
                        {(group.standings || []).map((row: any, idx: number) => {
                          // Real fields (confirmed): games/wins/draws/loses live
                          // under `row.total`, along with scoredGoals/receivedGoals
                          // (used here for the Goals column and computed GD).
                          const scored = row.total?.scoredGoals ?? 0;
                          const received = row.total?.receivedGoals ?? 0;
                          const gd = scored - received;
                          const isLeader = (row.position ?? idx + 1) === 1;
                          return (
                            <View key={row.team?.id ?? idx} style={[styles.standingsRow, isLeader && styles.standingsRowLeader]}>
                              <Text style={[styles.standingsCell, { width: 22 }]}>{row.position ?? idx + 1}</Text>
                              {row.team?.logo ? <Image source={{ uri: row.team.logo }} style={styles.standingsTeamLogo} /> : null}
                              <Text style={[styles.standingsCell, styles.standingsTeamName]} numberOfLines={1}>{row.team?.name}</Text>
                              <Text style={styles.standingsCell}>{row.total?.games ?? '-'}</Text>
                              <Text style={styles.standingsCell}>{row.total?.wins ?? '-'}</Text>
                              <Text style={styles.standingsCell}>{row.total?.draws ?? '-'}</Text>
                              <Text style={styles.standingsCell}>{row.total?.loses ?? '-'}</Text>
                              <Text style={[styles.standingsCell, { width: 52, fontSize: 11 }]}>{scored}:{received}</Text>
                              <Text style={[styles.standingsCell, gd > 0 ? styles.standingsGdPos : gd < 0 ? styles.standingsGdNeg : undefined]}>
                                {gd > 0 ? `+${gd}` : gd}
                              </Text>
                              <Text style={[styles.standingsCell, styles.standingsPts]}>{row.points ?? '-'}</Text>
                            </View>
                          );
                        })}
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyText}>Standings not available for this league.</Text>
                  )}
                </View>
              )
            ) : matchCenterLoading ? (
              <ActivityIndicator color={VIOLET} style={{ marginTop: 40 }} />
            ) : matchCenterError ? (
              <Text style={styles.emptyText}>{matchCenterError}</Text>
            ) : (
              <>
                {statsTab === 'statistics' && (
                  matchStatistics.length >= 2 ? (
                    <View>
                      {(() => {
                        const homeStats = matchStatistics[0];
                        const awayStats = matchStatistics[1];
                        // Curated list matched against the real displayName strings
                        // this API returns — anything not present for this match
                        // is simply skipped rather than shown as a fake zero.
                        const wanted = ['Possession', 'Shots on target', 'Shots off target', 'Corners', 'Fouls', 'Yellow cards', 'Red cards', 'Offsides'];
                        const findStat = (rows: any[], name: string) => rows.find(r => r.displayName === name)?.value;
                        return wanted.map(name => {
                          const h = findStat(homeStats.statistics, name);
                          const a = findStat(awayStats.statistics, name);
                          if (h === undefined && a === undefined) return null;
                          const hNum = Number(h) || 0;
                          const aNum = Number(a) || 0;
                          const isFraction = hNum <= 1 && aNum <= 1 && (hNum > 0 || aNum > 0);
                          const hDisplay = isFraction ? Math.round(hNum * 100) : hNum;
                          const aDisplay = isFraction ? Math.round(aNum * 100) : aNum;
                          const total = hDisplay + aDisplay || 1;
                          return (
                            <StatBar
                              key={name}
                              label={name}
                              home={hDisplay}
                              away={aDisplay}
                              homePct={(hDisplay / total) * 100}
                              awayPct={(aDisplay / total) * 100}
                              suffix={isFraction ? '%' : ''}
                              colorHome={CYAN}
                              colorAway={VIOLET}
                            />
                          );
                        });
                      })()}
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>Statistics not available for this match yet.</Text>
                  )
                )}

                {statsTab === 'lineups' && (
                  matchLineups ? (
                    <View style={styles.lineupContainer}>
                      {/* Team selector */}
                      <View style={styles.teamSelectorRow}>
                        <Pressable
                          style={[styles.teamSelectorChip, lineupTeamSide === 'home' && styles.teamSelectorChipActive]}
                          onPress={() => setLineupTeamSide('home')}
                        >
                          <Text style={[styles.teamSelectorText, lineupTeamSide === 'home' && styles.teamSelectorTextActive]}>
                            {safeTeamName(matchLineups.home?.name, selectedMatch?.home || 'Home')}
                            {safeFormation(matchLineups.home?.formation) ? ` (${safeFormation(matchLineups.home?.formation)})` : ''}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[styles.teamSelectorChip, lineupTeamSide === 'away' && styles.teamSelectorChipActive]}
                          onPress={() => setLineupTeamSide('away')}
                        >
                          <Text style={[styles.teamSelectorText, lineupTeamSide === 'away' && styles.teamSelectorTextActive]}>
                            {safeTeamName(matchLineups.away?.name, selectedMatch?.away || 'Away')}
                            {safeFormation(matchLineups.away?.formation) ? ` (${safeFormation(matchLineups.away?.formation)})` : ''}
                          </Text>
                        </Pressable>
                      </View>

                      {/* Formation / List toggle */}
                      <View style={styles.formationToggleRow}>
                        <Pressable
                          style={[styles.formationToggleBtn, lineupViewMode === 'formation' && styles.formationToggleBtnActive]}
                          onPress={() => setLineupViewMode('formation')}
                        >
                          <Text style={[styles.formationToggleText, lineupViewMode === 'formation' && styles.formationToggleTextActive]}>Formation</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.formationToggleBtn, lineupViewMode === 'list' && styles.formationToggleBtnActive]}
                          onPress={() => setLineupViewMode('list')}
                        >
                          <Text style={[styles.formationToggleText, lineupViewMode === 'list' && styles.formationToggleTextActive]}>List</Text>
                        </Pressable>
                      </View>

                      {/* Coach — the API doesn't provide this, so it defaults
                          to Violetkingdev for every match until/unless a real
                          coach field ever becomes available. */}
                      <View style={styles.coachRow}>
                        <Text style={styles.coachLabel}>Coach: </Text>
                        <Text style={styles.coachName}>Violetkingdev</Text>
                      </View>

                      {(() => {
                        const team = matchLineups[lineupTeamSide];
                        if (lineupViewMode === 'formation') {
                          return (
                            <View style={styles.pitch}>
                              {team.initialLineup.map((row, rowIdx) => (
                                <View key={rowIdx} style={styles.pitchRow}>
                                  {row.map(player => (
                                    <View key={player.id} style={styles.pitchPlayerCol}>
                                      <View style={styles.pitchPlayerCircle}>
                                        <Text style={styles.pitchPlayerNumber}>{player.number}</Text>
                                        {rowIdx === 0 && (
                                          <View style={styles.captainCrown}>
                                            <MaterialIcons name="stars" size={12} color="#FFD54F" />
                                          </View>
                                        )}
                                      </View>
                                      <Text style={styles.pitchPlayerName} numberOfLines={1}>{player.name}</Text>
                                    </View>
                                  ))}
                                </View>
                              ))}
                            </View>
                          );
                        }
                        // List view — flat, no pitch graphic
                        return (
                          <View style={styles.lineupListWrap}>
                            {team.initialLineup.flat().map(player => (
                              <View key={player.id} style={styles.lineupListRow}>
                                <Text style={styles.lineupListNumber}>{player.number}</Text>
                                <Text style={styles.lineupListName}>{player.name}</Text>
                                <Text style={styles.lineupListPosition}>{player.position}</Text>
                              </View>
                            ))}
                          </View>
                        );
                      })()}

                      {/* Substitutes */}
                      <Pressable style={styles.subsHeaderRow}>
                        <MaterialIcons name="swap-horiz" size={18} color={Colors.textSecondary} />
                        <Text style={styles.subsHeaderText}>Substitutes ({matchLineups[lineupTeamSide].substitutes.length})</Text>
                      </Pressable>
                      <View style={styles.subsGrid}>
                        {matchLineups[lineupTeamSide].substitutes.map(sub => (
                          <View key={sub.id} style={styles.subsItem}>
                            <Text style={styles.subsNumber}>{sub.number}</Text>
                            <Text style={styles.subsName}>{sub.name}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>Lineups not available for this match yet.</Text>
                  )
                )}

                {statsTab === 'events' && (
                  matchEvents.length > 0 ? (
                    <View style={styles.eventsContainer}>
                      {matchEvents.map((ev, idx) => {
                        const emoji = ev.type === 'Goal' ? '⚽' : ev.type === 'Yellow Card' ? '🟨' : ev.type === 'Red Card' ? '🟥' : ev.type === 'Substitution' ? '🔄' : '•';
                        // Confirmed real shape: `player`/`assist`/`substituted` are flat
                        // name strings (not nested objects). For a Substitution,
                        // `player` is who comes ON and `substituted` is who goes OFF.
                        // For a Goal, `assist` (if any) is the assist provider's name.
                        const description = ev.type === 'Substitution'
                          ? `${ev.player} ON, ${ev.substituted} OFF`
                          : ev.type === 'Goal' && ev.assist
                            ? `${ev.player} (assist: ${ev.assist})`
                            : ev.player;
                        return (
                          <View key={idx} style={styles.eventRow}>
                            <Text style={styles.eventMinute}>{ev.time}'</Text>
                            {ev.team?.logo ? (
                              <Image source={{ uri: ev.team.logo }} style={styles.eventTeamLogo} />
                            ) : null}
                            <View style={{ flex: 1 }}>
                              <Text style={styles.eventItem}>{emoji} {description}</Text>
                              <Text style={styles.eventTeamName}>{ev.team?.name}</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>No events available for this match yet.</Text>
                  )
                )}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Season picker for standings */}
      <Modal visible={showSeasonPicker} transparent animationType="fade" onRequestClose={() => setShowSeasonPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowSeasonPicker(false)}>
          <View style={styles.qualityMenu}>
            <Text style={styles.qualityMenuTitle}>Select Season</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {standingsSeasonOptions.map(season => (
                <Pressable
                  key={season}
                  style={[styles.qualityOption, standingsSeason === season && styles.qualityOptionActive]}
                  onPress={() => {
                    setShowSeasonPicker(false);
                    if (standingsLeagueId) loadStandings(standingsLeagueId, season);
                  }}
                >
                  <Text style={[styles.qualityOptionText, standingsSeason === season && styles.qualityOptionTextActive]}>{formatSeason(season)}</Text>
                  {standingsSeason === season && <MaterialIcons name="check" size={16} color={Colors.primary} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── FULL STYLES ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Upgraded from flat black to a deep navy-black so the glass header panel
  // and gradient accents actually have something to stand out against.
  root: { flex: 1, backgroundColor: '#0A0A12' },
  headerGlassWrap: {
    margin: Spacing.md,
    marginBottom: 0,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  headerTextWrap: { flex: 1 },
  // Opaque color here is required by MaskedView — it only reads the shape's
  // alpha, not the actual color, so the gradient underneath shows through
  // wherever this text is drawn.
  headerTitle: { color: '#000', fontSize: 24, fontWeight: FontWeights.black, letterSpacing: 0.5 },
  headerSub: { color: '#999', fontSize: 12, marginTop: 4, lineHeight: 17 },
  refreshButton: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: VIOLET, shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F1F1F',
    borderRadius: 20,
    marginHorizontal: Spacing.md,
    marginTop: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, color: '#fff', marginLeft: 8 },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.md,
    gap: 10,
    marginBottom: Spacing.md,
  },
  chipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F1F1F',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
    gap: 6,
    width: '30%',
    justifyContent: 'center',
  },
  chipItemActive: {
    backgroundColor: CYAN,
    borderColor: CYAN,
  },
  chipText: { color: '#fff', fontSize: 12 },
  chipTextActive: { color: BG_DARK },
  content: { padding: Spacing.md, paddingBottom: 100 },
  section: { marginBottom: 24 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sectionTitleWithBadge: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  badge: {
    backgroundColor: VIOLET,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  card: { backgroundColor: '#1C1C1E', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2C2C2E' },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  cardLeague: { color: '#888', fontSize: 12, fontWeight: '600' },
  statusPill: { backgroundColor: '#333', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillLive: { backgroundColor: LIVE_RED },
  statusPillFinished: { backgroundColor: '#222' },
  statusText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  cardMidRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  teamSide: { flexDirection: 'column', alignItems: 'center', flex: 1 },
  teamLogo: { width: 48, height: 48, borderRadius: 24, marginBottom: 4, resizeMode: 'contain' },
  fallbackLogo: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  fallbackText: { color: '#888', fontWeight: 'bold', fontSize: 12 },
  teamName: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  centerScoreArea: { alignItems: 'center', flex: 1 },
  scoreText: { color: CYAN, fontSize: 28, fontWeight: 'bold' },
  upcomingTime: { color: '#FFD54F', fontSize: 18, fontWeight: 'bold' },
  upcomingRound: { color: '#888', fontSize: 10 },
  cardBottomRow: { flexDirection: 'row', gap: 12 },
  watchLiveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: LIVE_RED, borderRadius: 10, paddingVertical: 12 },
  watchLiveBtnFull: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: LIVE_RED, borderRadius: 10, paddingVertical: 12,
  },
  detailsBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#333', borderRadius: 10, paddingVertical: 12 },
  detailsBtnFull: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#333', borderRadius: 10, paddingVertical: 12, gap: 6 },
  btnText: { color: '#fff', fontWeight: 'bold', marginLeft: 6 },
  emptyText: { color: '#888', textAlign: 'center', marginTop: 40 },
  newsCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  newsImageWrapper: {
    position: 'relative',
    width: '100%',
    height: 200,
    backgroundColor: '#2C2C2E',
  },
  newsImage: { width: '100%', height: '100%' },
  newsImageFallback: { alignItems: 'center', justifyContent: 'center' },
  trendingBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.6)',
  },
  trendingBadgeText: { color: '#00E5FF', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  newsContent: { padding: 16, gap: 8 },
  newsDate: { color: '#666', fontSize: 11, fontWeight: '500', letterSpacing: 0.5, textTransform: 'uppercase' },
  newsTitle: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 24 },
  newsSummary: { color: '#999', fontSize: 14, lineHeight: 20, marginTop: 2 },
  readMoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  readMoreText: { color: '#00E5FF', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  readMoreLine: { flex: 1, height: 2, backgroundColor: 'rgba(0, 229, 255, 0.3)', borderRadius: 2 },
  highlightCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
  },
  highlightImage: { width: '100%', height: 180 },
  highlightImageFallback: { width: '100%', height: 180, backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' },
  highlightOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', padding: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  highlightTitle: { color: '#fff', fontSize: 14, fontWeight: '500', marginLeft: 8, flex: 1 },
  videoRoot: { flex: 1, backgroundColor: BG_DARK },
  videoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  videoTitleWrap: { flex: 1, marginLeft: 12 },
  videoTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  videoSub: { color: '#888', fontSize: 12 },
  liveBadge: { backgroundColor: LIVE_RED, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginRight: 12 },
  liveBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  videoContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', marginVertical: Spacing.md, borderRadius: 12, overflow: 'hidden' },
  videoPlayer: { width: '100%', height: '100%' },
  videoWebView: { width: '100%', height: '100%' },
  videoIframe: { width: '100%', height: '100%', border: 'none' },
  emptyPlayer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  retryStreamBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: VIOLET, borderRadius: Radii.md, paddingHorizontal: 20, paddingVertical: 10, marginTop: 16 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 8, gap: 12 },
  controlLabel: { color: '#888', fontSize: 12, fontWeight: 'bold', width: 60 },
  streamGrid: { flexDirection: 'row', gap: 10 },
  streamBtn: { width: 42, height: 42, borderRadius: 8, backgroundColor: '#1C1C1E', justifyContent: 'center', alignItems: 'center' },
  streamBtnActive: { backgroundColor: CYAN },
  streamBtnText: { color: '#888', fontWeight: 'bold' },
  sourceBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1C1C1E' },
  sourceBtnText: { color: '#fff', fontSize: 12 },
  reportRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 8, gap: 6 },
  reportText: { color: '#888', fontSize: 12 },
  videoFooter: { padding: Spacing.md },
  footerLeagueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  footerLiveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE_RED },
  footerLiveText: { color: LIVE_RED, fontSize: 10, fontWeight: 'bold' },
  footerTeamRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#222' },
  footerLogo: { width: 36, height: 36, borderRadius: 18, resizeMode: 'contain' },
  footerLogoFallback: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center' },
  footerTeamName: { flex: 1, color: '#fff', fontWeight: 'bold', fontSize: 14, marginLeft: 10 },
  footerScoreNum: { color: '#fff', fontWeight: 'bold', fontSize: 20, minWidth: 30, textAlign: 'right' },
  footerVs: { color: '#555', fontSize: 11, textAlign: 'center', paddingVertical: 4 },
  leagueText: { color: '#888', fontSize: 12, textAlign: 'center' },
  // Stats Modal styles
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#222' },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: CYAN },
  tabText: { color: '#888', fontSize: 12, fontWeight: 'bold' },
  tabTextActive: { color: CYAN },
  tabIndicator: { width: 20, height: 2, backgroundColor: CYAN, marginTop: 4 },
  statRow: { marginBottom: 20 },
  statLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  statLabel: { color: '#888', fontSize: 12 },
  statValues: { flexDirection: 'row', gap: 10 },
  statVal: { fontSize: 14, fontWeight: 'bold' },
  statBarBg: { flexDirection: 'row', height: 8, borderRadius: 4, backgroundColor: '#222', overflow: 'hidden' },
  statBarFill: { height: '100%', borderRadius: 4 },
  lineupContainer: { padding: 20, alignItems: 'stretch' },
  lineupTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  lineupSub: { color: '#888', fontSize: 12, marginBottom: 20 },
  lineupRow: { flexDirection: 'row', width: '100%', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#222' },
  pos: { width: 40, color: CYAN, fontWeight: 'bold' },
  posName: { flex: 1, color: '#fff' },
  eventsContainer: { padding: 16 },
  eventItem: { color: '#fff', paddingVertical: 0 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#222' },
  eventMinute: { color: CYAN, fontWeight: FontWeights.bold, width: 36, fontSize: FontSizes.sm },
  eventTeamLogo: { width: 20, height: 20, resizeMode: 'contain' },
  eventTeamName: { color: '#888', fontSize: FontSizes.xs, marginTop: 2 },

  // Standings table
  standingsLeagueTitle: { color: '#fff', fontSize: FontSizes.md, fontWeight: FontWeights.bold, marginBottom: 12 },
  standingsHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#333' },
  standingsHeaderCell: { color: '#888', fontSize: FontSizes.xs, fontWeight: FontWeights.bold, width: 32, textAlign: 'center' },
  standingsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#222', gap: 6 },
  standingsCell: { color: '#fff', fontSize: FontSizes.xs, width: 32, textAlign: 'center' },
  standingsTeamLogo: { width: 18, height: 18, resizeMode: 'contain' },
  standingsTeamName: { flex: 1, width: undefined, textAlign: 'left', fontWeight: FontWeights.medium },
  standingsPts: { color: CYAN, fontWeight: FontWeights.bold },

  // Standings header (league logo/name + season dropdown) and extras
  standingsTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  standingsLeagueHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  standingsLeagueLogo: { width: 26, height: 26, resizeMode: 'contain' },
  standingsLeagueName: { color: '#fff', fontSize: FontSizes.md, fontWeight: FontWeights.bold, flexShrink: 1 },
  seasonDropdownBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1F1F1F', borderRadius: Radii.md, paddingHorizontal: 12, paddingVertical: 6, gap: 2 },
  seasonDropdownText: { color: '#fff', fontSize: FontSizes.xs, fontWeight: FontWeights.bold },
  standingsGroupTitle: { color: '#aaa', fontSize: FontSizes.sm, fontWeight: FontWeights.bold, marginBottom: 8 },
  standingsTeamHeaderCell: { flex: 1, width: undefined, textAlign: 'left' },
  standingsRowLeader: { backgroundColor: 'rgba(124,58,237,0.12)', borderRadius: Radii.sm },
  standingsGdPos: { color: '#4ade80', fontWeight: FontWeights.bold },
  standingsGdNeg: { color: '#f87171', fontWeight: FontWeights.bold },

  // Generic small popup menu (used by the season picker)
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  qualityMenu: { backgroundColor: '#1a1a2e', borderRadius: Radii.lg, paddingVertical: 8, minWidth: 220, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  qualityMenuTitle: { color: '#888', fontSize: FontSizes.xs, fontWeight: FontWeights.bold, paddingHorizontal: 16, paddingVertical: 8, letterSpacing: 1 },
  qualityOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  qualityOptionActive: { backgroundColor: 'rgba(124,58,237,0.15)' },
  qualityOptionText: { color: Colors.textPrimary, fontSize: FontSizes.sm, fontWeight: FontWeights.medium },
  qualityOptionTextActive: { color: VIOLET },

  // Match Details score header (shown above the tab bar regardless of tab)
  mcScoreHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: '#222' },
  mcTeamCol: { flex: 1, alignItems: 'center', gap: 6 },
  mcTeamLogo: { width: 44, height: 44, borderRadius: 22 },
  mcTeamName: { color: '#fff', fontSize: FontSizes.sm, fontWeight: FontWeights.bold, textAlign: 'center' },
  mcScoreCol: { alignItems: 'center', gap: 4, paddingHorizontal: Spacing.md },
  mcScoreText: { color: '#fff', fontSize: 26, fontWeight: FontWeights.black },

  // Lineups: team selector + formation/list toggle
  teamSelectorRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  teamSelectorChip: { flex: 1, paddingVertical: 10, borderRadius: Radii.md, backgroundColor: '#1F1F1F', alignItems: 'center' },
  teamSelectorChipActive: { backgroundColor: VIOLET },
  teamSelectorText: { color: '#aaa', fontSize: FontSizes.xs, fontWeight: FontWeights.bold, textAlign: 'center' },
  teamSelectorTextActive: { color: '#fff' },
  formationToggleRow: { flexDirection: 'row', alignSelf: 'flex-end', backgroundColor: '#1F1F1F', borderRadius: Radii.md, padding: 2, marginBottom: 12 },
  formationToggleBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radii.sm },
  formationToggleBtnActive: { backgroundColor: '#333' },
  formationToggleText: { color: '#888', fontSize: FontSizes.xs, fontWeight: FontWeights.bold },
  formationToggleTextActive: { color: '#fff' },
  coachRow: { flexDirection: 'row', marginBottom: 12 },
  coachLabel: { color: '#888', fontSize: FontSizes.sm },
  coachName: { color: '#fff', fontSize: FontSizes.sm, fontWeight: FontWeights.bold },

  // Pitch (formation view)
  pitch: { backgroundColor: '#0F3D1E', borderRadius: Radii.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingVertical: 20, gap: 22, marginBottom: 20 },
  pitchRow: { flexDirection: 'row', justifyContent: 'space-evenly' },
  pitchPlayerCol: { alignItems: 'center', width: 64, gap: 4 },
  pitchPlayerCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: VIOLET, alignItems: 'center', justifyContent: 'center' },
  pitchPlayerNumber: { color: '#fff', fontSize: FontSizes.sm, fontWeight: FontWeights.bold },
  captainCrown: { position: 'absolute', top: -8, right: -6 },
  pitchPlayerName: { color: '#fff', fontSize: 10, textAlign: 'center' },

  // Lineups: list view
  lineupListWrap: { marginBottom: 20 },
  lineupListRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#222', gap: 12 },
  lineupListNumber: { width: 28, color: CYAN, fontWeight: FontWeights.bold },
  lineupListName: { flex: 1, color: '#fff', fontWeight: FontWeights.medium },
  lineupListPosition: { color: '#888', fontSize: FontSizes.xs },

  // Substitutes
  subsHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  subsHeaderText: { color: Colors.textSecondary, fontSize: FontSizes.sm, fontWeight: FontWeights.bold },
  subsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  subsItem: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '47%', backgroundColor: '#1F1F1F', borderRadius: Radii.md, paddingHorizontal: 12, paddingVertical: 10 },
  subsNumber: { color: VIOLET, fontWeight: FontWeights.bold, width: 20 },
  subsName: { color: '#fff', flex: 1 },
});

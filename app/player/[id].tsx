import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ActivityIndicator,
  Modal, PanResponder, GestureResponderEvent, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, FontSizes, FontWeights, Radii } from '@/constants/theme';
import { getMovieDetails } from '@/services/tmdbService';
import { getFallbackStreamUrl, StreamType } from '@/services/streamService';
import { resolveStreamSource, searchOmegatechByTitle } from '@/services/streamResolver';
import { triggerSecureDownload } from '@/services/secureDownload';
import { apiUrl } from '@/services/providers';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAlert } from '@/template';
import { WatchPartyBanner } from '@/components/ui/WatchPartyBanner';
import { useMiniPlayer } from '@/contexts/MiniPlayerContext';

// Some quality URLs are relative (our own /api/download-file proxy, used only
// as a fallback when Omegatech's own safe stream/download URLs aren't
// available). WebBrowser.openBrowserAsync needs an absolute URL, so relative
// ones get resolved via apiUrl(); anything already absolute passes through.
function toAbsoluteUrl(u: string | null | undefined): string {
  if (!u) return '';
  if (u.startsWith('/')) {
    const [path, qs] = u.split('?');
    return apiUrl(path, Object.fromEntries(new URLSearchParams(qs || '')));
  }
  return u;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function firstParam(v: string | string[] | undefined) { return Array.isArray(v) ? v[0] : v; }
function safeDecodeParam(v: string | undefined, fallback: string) {
  if (!v) return fallback; try { return decodeURIComponent(v); } catch { return v; }
}
function isDirectVideoUrl(u: string | null | undefined) { return Boolean(u && /\.(?:mp4|webm|ogg)(?:[?#]|$)/i.test(u)); }

// ─── EXTENDED AD BLOCK LIST ──────────────────────────────────────────────
const AD_BLOCKED_DOMAINS = [
  'doubleclick.net','googlesyndication.com','adnxs.com','popads.net','popcash.net',
  'trafficjunky.net','exoclick.com','juicyads.com','tubecorporate.com','adsrvr.org',
  'pubmatic.com','openx.net','rubiconproject.com','adform.net','smartadserver.com',
  'tidaltv.com','loopme.com','undertone.com','spotxchange.com','bidswitch.net',
  'adsterra.com','propellerads.com','clickadu.com','mgid.com','outbrain.com',
  'taboola.com','revcontent.com','contentabc.com','trafficfactory.biz',
  'onclickads.net','adf.ly','shorte.st','bc.vc','linkbucks.com','adfly.com',
  'adzly.com','adfoc.us','yllix.com','adworkmedia.com','adxad.net','popunder.ru',
  'trafmag.com','adnium.com','cpmstar.com','adengage.com','adbrite.com',
  'adition.com','adzerk.com','adroll.com','criteo.com','casalemedia.com',
  'contextweb.com','pubexchange.com','sharethrough.com','sonobi.com','tapad.com',
  'triplelift.com','xad.com',
  'getlocawifi.shop','b7510.com','prosystems.click',
  'richnannyhub.xyz','eu.richnannyhub.xyz',
  'sports.bet9ja.com','bet9ja.com',
  'eazeebet.com',
  'kanjp.com','cdn.kanjp.com',
  '1xbet.ng',
  'aabdw.com','cdn.aabdw.com',
  'stake.com',
  'duckduckgo.com',
  'brainchallengeng.com',
  'betway.com.ng'
];

const SPEED_OPTIONS = [
  { label: '0.25x', value: 0.25 },{ label: '0.5x', value: 0.5 },
  { label: '0.75x', value: 0.75 },{ label: 'Normal', value: 1 },
  { label: '1.25x', value: 1.25 },{ label: '1.5x', value: 1.5 },
  { label: '1.75x', value: 1.75 },{ label: '2x', value: 2 },
];

const QUALITY_OPTIONS = [
  { label: 'Best', value: 'best' },
  { label: '1080p', value: '1080p' },
  { label: '720p', value: '720p' },
  { label: '480p', value: '480p' },
  { label: '360p', value: '360p' },
];

function getProgressKey(id: string, type: string, ep?: string, season?: string) {
  return `vflixtv_progress_${type}_${id}${season ? `_s${season}` : ''}${ep ? `_e${ep}` : ''}`;
}

export default function PlayerScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const id = firstParam(params.id) || '';
  const type = firstParam(params.type) || 'movie';
  const ep = firstParam(params.ep);
  const season = firstParam(params.season);
  const title = firstParam(params.title);
  const trailerKey = firstParam(params.trailerKey);
  const trailer = firstParam(params.trailer);
  const malId = firstParam(params.malId);
  const partyCode = firstParam(params.partyCode);
  const partyHost = firstParam(params.partyHost);
  // Omegatech params
  const subjectId = firstParam(params.subjectId);
  const detailPath = firstParam(params.detailPath);
  // Effective values actually used for the Omegatech quality/download lookup.
  // Start as whatever came in via the route, but get upgraded in the resolution
  // effect below if we only have a TMDB id (no real detailPath) and have to
  // find the real Omegatech match by title first.
  const [effectiveSubjectId, setEffectiveSubjectId] = useState(subjectId || '');
  const [effectiveDetailPath, setEffectiveDetailPath] = useState(detailPath || '');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { startDownload } = useWatchlist();
  const { showAlert } = useAlert();
  const { openMiniPlayer } = useMiniPlayer();

  const streamType = type as StreamType;
  const decodedTitle = safeDecodeParam(title, 'VioletFlix Player');
  const episodeLabel = ep ? `Episode ${ep}` : null;
  const seasonLabel = season ? `Season ${season}` : null;
  const typeColor = streamType === 'anime' ? '#f59e0b' : streamType === 'tv' ? '#06b6d4' : Colors.primary;
  const progressKey = getProgressKey(id, type, ep, season);

  // Watch Party state
  const [partyActive, setPartyActive] = useState(!!partyCode);
  const [partyMemberCount, setPartyMemberCount] = useState(2);

  // Player state
  const [showControls, setShowControls] = useState(true);
  const [streamLoaded, setStreamLoaded] = useState(false);
  const [streamFailed, setStreamFailed] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [trailerVideoKey, setTrailerVideoKey] = useState<string | null>(trailerKey || null);
  const [playingTrailer, setPlayingTrailer] = useState(trailer === '1');
  const [resolvedPrimaryUrl, setResolvedPrimaryUrl] = useState<string | null>(null);
  const [resolvingStream, setResolvingStream] = useState(true);
  const [downloadingCurrent, setDownloadingCurrent] = useState(false);

  // Quality selection
  const [availableQualities, setAvailableQualities] = useState<{ label: string; value: string; url: string; downloadUrl: string; size?: string }[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>('best');
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [showDownloadQualityModal, setShowDownloadQualityModal] = useState(false);
  const [loadingQualities, setLoadingQualities] = useState(false);

  // Enhanced feature state
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [savedProgress, setSavedProgress] = useState(0);
  const [showNextEpisode, setShowNextEpisode] = useState(false);
  const [nextEpCountdown, setNextEpCountdown] = useState(10);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Touch gesture state
  const gestureRef = useRef({ startX: 0, startY: 0, startTime: 0, lastTapTime: 0, lastTapX: 0 });
  const seekIndicatorRef = useRef<'forward' | 'backward' | null>(null);
  const [seekIndicator, setSeekIndicator] = useState<{ dir: 'forward' | 'backward'; secs: number } | null>(null);
  const webviewRef = useRef<WebView>(null);

  const fallbackStreamUrl = useMemo(() => getFallbackStreamUrl({ id, type: streamType, season, episode: ep, malId }), [id, streamType, season, ep, malId]);

  // ── Fetch available qualities (uses effective subjectId/detailPath, which
  //    may have been upgraded from a bare TMDB id via title-search below) ─────
const fetchQualities = useCallback(async (overrideSubjectId?: string, overrideDetailPath?: string): Promise<boolean> => {
  const sid = overrideSubjectId ?? effectiveSubjectId;
  const dp = overrideDetailPath ?? effectiveDetailPath;
  if (!sid) return false;
  setLoadingQualities(true);
  try {
    const seasonParam = streamType === 'movie' ? undefined : (season || 1);
    const episodeParam = streamType === 'movie' ? undefined : (ep || 1);
    const url = `/api/download?subject_id=${encodeURIComponent(sid)}&detail_path=${encodeURIComponent(dp || '')}` +
      (seasonParam !== undefined ? `&season=${seasonParam}` : '') +
      (episodeParam !== undefined ? `&episode=${episodeParam}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch qualities');
    const data = await res.json();

    const qualities: { label: string; value: string; url: string; downloadUrl: string; size?: string }[] = [];
    if (data.downloads && Array.isArray(data.downloads)) {
      data.downloads.forEach((item: any) => {
        if ((item.streamUrl || item.url) && item.resolution) {
          // The server (scripts/api-proxy.js) already decides whether each
          // item is a safe, direct omegatech.app URL (used as-is — confirmed
          // via curl to work with no Referer/CORS issues) or the raw,
          // 403-prone CDN link (wrapped into our own Referer-spoofing proxy
          // as a last resort). Just use whatever it gives us; only need to
          // absolute-ize the rare relative fallback case.
          qualities.push({
            label: item.resolution,
            value: item.resolution.toLowerCase(),
            url: toAbsoluteUrl(item.streamUrl || item.url),
            downloadUrl: toAbsoluteUrl(item.safeUrl || item.url),
            size: item.size,
          });
        }
      });
    }

    const unique = qualities.filter((q, index, self) => self.findIndex(t => t.value === q.value) === index);
    setAvailableQualities(unique);

    if (unique.length > 0) {
      const best = unique.find(q => q.value === 'best');
      const selected = best || unique[0];
      setSelectedQuality(selected.value);
      setResolvedPrimaryUrl(selected.url);
      setLoadingQualities(false);
      return true;
    }
    return false;
  } catch (e) {
    console.warn('Failed to load qualities:', e);
    return false;
  } finally {
    setLoadingQualities(false);
  }
}, [effectiveSubjectId, effectiveDetailPath, streamType, season, ep]);


  // ── Stream resolution (Omegatech first, then fallback) ──────────────────────
useEffect(() => {
  let mounted = true;
  if (playingTrailer) { setResolvingStream(false); return () => { mounted = false; }; }

  setResolvingStream(true);
  setResolvedPrimaryUrl(null);
  setStreamLoaded(false);
  setStreamFailed(false);
  setUsingFallback(false);

  const resolve = async () => {
    // 1. We already have a real Omegatech subjectId+detailPath (e.g. found via
    //    Search, which now correctly passes these through) — use it directly.
    if (subjectId && detailPath) {
      const success = await fetchQualities(subjectId, detailPath);
      if (success && mounted) {
        setResolvingStream(false);
        return;
      }
    }

    // 2. We only have a bare TMDB id (typical when reached via a TMDB-only
    //    detail page, not Search) — search Omegatech by title to find the real
    //    subjectId/detailPath pair BEFORE giving up. This is what makes
    //    quality selection and downloads work for this content too, not just
    //    a single best-effort playback URL.
    if (mounted && decodedTitle && decodedTitle !== 'VioletFlix Player') {
      const yearFromTitle = decodedTitle.match(/\b(19|20)\d{2}\b/)?.[0];
      const found = await searchOmegatechByTitle(decodedTitle, yearFromTitle);
      if (found?.subjectId && mounted) {
        setEffectiveSubjectId(found.subjectId);
        setEffectiveDetailPath(found.detailPath);
        const success = await fetchQualities(found.subjectId, found.detailPath);
        if (success && mounted) {
          setResolvingStream(false);
          return;
        }
      }
    }

    // 3. Fallback to embed providers (via streamResolver) — this still does
    //    its own internal title-search as a last resort, but at this point
    //    we've already tried the direct route above.
    if (mounted) {
      const yearFromTitle = decodedTitle.match(/\b(19|20)\d{2}\b/)?.[0];
      const source = await resolveStreamSource({
        id,
        type: streamType,
        season,
        episode: ep,
        malId,
        title: decodedTitle,
        subjectId,
        detailPath,
        year: yearFromTitle || undefined,
      });
      if (source && source.url) {
        setResolvedPrimaryUrl(source.url);
        setUsingFallback(true);
        setResolvingStream(false);
        return;
      }
    }

    // 3. Ultimate fallback (direct stream URL from getFallbackStreamUrl)
    if (mounted) {
      const fallback = getFallbackStreamUrl({ id, type: streamType, season, episode: ep, malId });
      if (fallback) {
        setResolvedPrimaryUrl(fallback);
        setUsingFallback(true);
        setResolvingStream(false);
        return;
      }
    }

    // 4. Everything failed
    if (mounted) {
      setStreamFailed(true);
      setResolvingStream(false);
    }
  };

  resolve();

  return () => { mounted = false; };
}, [id, type, season, ep, malId, decodedTitle, subjectId, detailPath, fetchQualities, playingTrailer]);

  // ── Progress save + episode end detection via injected JS ────────────────
  const progressSaveScript = `
    (function() {
      if (!window._vftvProgressInterval) {
        window._vftvProgressInterval = setInterval(function() {
          var v = document.querySelector('video');
          if (v && !v.paused && v.currentTime > 0) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'progress', currentTime: v.currentTime, duration: v.duration
            }));
          }
        }, 8000);
        var vv = document.querySelector('video');
        if (vv) vv.addEventListener('ended', function() {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ended' }));
        });
      }
    })(); true;`;

  // ── Enhanced Ads Guard (full, expanded) ──────────────────────────────────
  const adsGuardScript = `
    (function() {
      var adDomains = ${JSON.stringify(AD_BLOCKED_DOMAINS)};

      // --- BLOCK CLICK REDIRECTS ---
      document.addEventListener('click', function(e) {
        var target = e.target.closest('a');
        if (target && target.href) {
          if (adDomains.some(function(d){ return String(target.href).includes(d); })) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }, true);

      // --- BLOCK WINDOW.OPEN ---
      var origOpen = window.open;
      window.open = function(url) {
        if (!url) return null;
        if (adDomains.some(function(d){ return String(url).includes(d); })) return null;
        return null;
      };

      // --- BLOCK WINDOW.LOCATION REDIRECTS ---
      var origLocation = Object.getOwnPropertyDescriptor(window, 'location');
      if (origLocation) {
        Object.defineProperty(window, 'location', {
          configurable: false,
          enumerable: true,
          get: function() { return origLocation.get.call(this); },
          set: function(url) {
            if (!url) return;
            var strUrl = String(url);
            if (adDomains.some(function(d){ return strUrl.includes(d); })) {
              console.warn('[AdGuard] Blocked location redirect to:', strUrl);
              return;
            }
            origLocation.set.call(this, url);
          }
        });
      }

      // --- BLOCK WINDOW.TOP.LOCATION REDIRECTS ---
      if (window.top && window.top !== window) {
        var origTopLocation = Object.getOwnPropertyDescriptor(window.top, 'location');
        if (origTopLocation) {
          Object.defineProperty(window.top, 'location', {
            configurable: false,
            enumerable: true,
            get: function() { return origTopLocation.get.call(this); },
            set: function(url) {
              if (!url) return;
              var strUrl = String(url);
              if (adDomains.some(function(d){ return strUrl.includes(d); })) {
                console.warn('[AdGuard] Blocked top.location redirect to:', strUrl);
                return;
              }
              origTopLocation.set.call(this, url);
            }
          });
        }
      }

      // --- BLOCK AD REDIRECTS VIA INTERVAL (for persistent ad scripts) ---
      var redirectInterval = setInterval(function() {
        try {
          if (window.location && adDomains.some(function(d){ return String(window.location.href).includes(d); })) {
            console.warn('[AdGuard] Location already on ad domain, preventing further redirects.');
          }
        } catch(e) {}
      }, 500);

      // --- BLOCK VISIBILITYCHANGE AND BLUR ---
      document.addEventListener = (function(orig) {
        return function(type, fn, opts) {
          if (type === 'visibilitychange' || type === 'blur') return;
          return orig.call(document, type, fn, opts);
        };
      })(document.addEventListener);
    })(); true;`;

  // ── Speed injection ──────────────────────────────────────────────────────
  const speedScript = playbackSpeed !== 1 ? `
    (function() {
      var v = document.querySelector('video');
      if (v) v.playbackRate = ${playbackSpeed};
      new MutationObserver(function() {
        var vv = document.querySelector('video');
        if (vv) vv.playbackRate = ${playbackSpeed};
      }).observe(document.body, { childList: true, subtree: true });
    })(); true;` : '';

  // ── Picture-in-Picture Button (full, expanded) ──────────────────────────
  const pipScript = `
    (function() {
      const video = document.querySelector('video');
      if (video && !document.getElementById('vftv-pip-btn')) {
        const pipBtn = document.createElement('button');
        pipBtn.id = 'vftv-pip-btn';
        pipBtn.innerText = '📺 PiP';
        pipBtn.style.position = 'absolute';
        pipBtn.style.bottom = '20px';
        pipBtn.style.right = '20px';
        pipBtn.style.zIndex = '9999';
        pipBtn.style.background = 'rgba(124,58,237,0.9)';
        pipBtn.style.color = 'white';
        pipBtn.style.border = 'none';
        pipBtn.style.padding = '8px 14px';
        pipBtn.style.borderRadius = '8px';
        pipBtn.style.fontSize = '13px';
        pipBtn.style.cursor = 'pointer';
        pipBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

        pipBtn.onclick = async () => {
          try {
            if (document.pictureInPictureElement) {
              await document.exitPictureInPicture();
            } else if (video.requestPictureInPicture) {
              await video.requestPictureInPicture();
            }
          } catch (err) {
            console.warn('PiP failed:', err);
          }
        };

        video.parentNode.style.position = 'relative';
        video.parentNode.appendChild(pipBtn);
      }
    })();
  `;

  const finalInjectedScript = [
    adsGuardScript,
    progressSaveScript,
    speedScript,
    pipScript
  ].filter(Boolean).join('\n');

  const handleWebViewMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'progress') {
        AsyncStorage.setItem(progressKey, String(msg.currentTime)).catch(() => {});
      } else if (msg.type === 'ended') {
        if ((streamType === 'tv' || streamType === 'anime') && ep) {
          setShowNextEpisode(true); setNextEpCountdown(10);
        }
      }
    } catch {}
  }, [progressKey, streamType, ep]);

  // Next episode countdown
  useEffect(() => {
    if (!showNextEpisode) return;
    countdownRef.current = setInterval(() => {
      setNextEpCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          const nextEp = String((parseInt(ep || '1') || 1) + 1);
          router.replace(`/player/${id}?type=${streamType}&ep=${nextEp}&season=${season || '1'}&title=${encodeURIComponent(decodedTitle)}${effectiveSubjectId ? `&subjectId=${effectiveSubjectId}` : ''}${effectiveDetailPath ? `&detailPath=${effectiveDetailPath}` : ''}`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [showNextEpisode]);

  // Save progress on unmount
  useEffect(() => {
    return () => {
      webviewRef.current?.injectJavaScript(`
        var v = document.querySelector('video');
        if (v && v.currentTime > 0) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'progress', currentTime: v.currentTime, duration: v.duration
          }));
        }
      `);
    };
  }, []);

  // ── SWIPE GESTURE HANDLER (full, expanded) ──────────────────────────────
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8,

    onPanResponderGrant: (e) => {
      const now = Date.now();
      const { locationX, locationY } = e.nativeEvent;
      gestureRef.current.startX = locationX;
      gestureRef.current.startY = locationY;
      gestureRef.current.startTime = now;

      // Double-tap detection
      const timeSinceLast = now - gestureRef.current.lastTapTime;
      const xDiff = Math.abs(locationX - gestureRef.current.lastTapX);
      if (timeSinceLast < 300 && xDiff < 80) {
        // Double tap — skip ±10s
        const isRight = locationX > SCREEN_W / 2;
        const secs = isRight ? 10 : -10;
        const dir = isRight ? 'forward' : 'backward';
        webviewRef.current?.injectJavaScript(`
          var v = document.querySelector('video');
          if (v) v.currentTime = Math.max(0, v.currentTime + ${secs});
          true;`);
        setSeekIndicator({ dir, secs: Math.abs(secs) });
        setTimeout(() => setSeekIndicator(null), 800);
        gestureRef.current.lastTapTime = 0;
        return;
      }
      gestureRef.current.lastTapTime = now;
      gestureRef.current.lastTapX = locationX;
    },

    onPanResponderRelease: (_, gs) => {
      const { dx, dy } = gs;
      const absDx = Math.abs(dx), absDy = Math.abs(dy);
      const elapsed = Date.now() - gestureRef.current.startTime;
      if (elapsed > 600) return; // too slow = not a swipe

      if (absDx > 40 && absDx > absDy * 1.5) {
        // Horizontal swipe → seek (scaled by distance)
        const seekSecs = Math.round((absDx / SCREEN_W) * 60) * (dx > 0 ? 1 : -1);
        webviewRef.current?.injectJavaScript(`
          var v = document.querySelector('video');
          if (v) v.currentTime = Math.max(0, v.currentTime + ${seekSecs});
          true;`);
        const dir = dx > 0 ? 'forward' : 'backward';
        setSeekIndicator({ dir, secs: Math.abs(seekSecs) });
        setTimeout(() => setSeekIndicator(null), 800);
      } else if (absDy > 40 && absDy > absDx * 1.5) {
        // Vertical swipe → volume
        const volDelta = -dy / SCREEN_H;
        webviewRef.current?.injectJavaScript(`
          var v = document.querySelector('video');
          if (v) v.volume = Math.min(1, Math.max(0, v.volume + ${volDelta.toFixed(2)}));
          true;`);
      } else if (absDx < 12 && absDy < 12) {
        // Tap → toggle controls
        setShowControls(c => !c);
      }
    },
  });

  // ── HANDLE BACK BUTTON (Mini‑Player for mobile) ──────────────────────
  const handleBack = () => {
    if (Platform.OS !== 'web' && resolvedPrimaryUrl) {
      openMiniPlayer({
        url: resolvedPrimaryUrl,
        title: decodedTitle,
        id: id,
      });
      router.back();
      return;
    }
    router.back();
  };

  const handleRetry = () => {
    if (playingTrailer) { setStreamLoaded(false); setStreamFailed(false); return; }
    if (!usingFallback && fallbackStreamUrl) setUsingFallback(true);
    else { setStreamLoaded(false); setStreamFailed(false); }
  };

  const handleOpenExternal = async () => {
    if (!resolvedPrimaryUrl) return;
    try {
      await WebBrowser.openBrowserAsync(toAbsoluteUrl(resolvedPrimaryUrl));
    } catch {}
  };

  // Download button now opens a quality picker (matching the reference UI you
  // wanted) instead of silently grabbing 1080p/best automatically.
  const handleDownloadPress = () => {
    if (availableQualities.length > 0) {
      setShowDownloadQualityModal(true);
    } else {
      // No qualities loaded (e.g. fetchQualities failed) — fall back to the
      // old automatic behavior so Download still does *something*.
      handleDownloadCurrent();
    }
  };

  const performDownloadForQuality = async (q: { label: string; value: string; url: string; downloadUrl: string; size?: string }) => {
    setShowDownloadQualityModal(false);
    if (downloadingCurrent) return;
    setDownloadingCurrent(true);
    try {
      const sourceUrl = q.downloadUrl || q.url;
      await startDownload({
        id: `${streamType}-dl-${id}${season ? `-s${season}` : ''}${ep ? `-e${ep}` : ''}-${q.value}`,
        mediaId: Number(id) || 0, mediaType: streamType, title: decodedTitle,
        posterUrl: '', rating: 0,
        season: season ? Number(season) : undefined, episode: ep ? Number(ep) : undefined,
        episodeName: episodeLabel || undefined,
        size: q.size || 'Direct link',
        status: sourceUrl ? 'completed' : 'failed', progress: sourceUrl ? 100 : 0,
        sourceUrl: sourceUrl || undefined,
      });
      if (sourceUrl) await triggerSecureDownload({ url: sourceUrl, fileName: `${decodedTitle}${episodeLabel ? ` ${episodeLabel}` : ''} ${q.label}.mp4`, preResolved: true });
      showAlert(sourceUrl ? 'Download Started' : 'Download Unavailable', sourceUrl ? `Started ${q.label} download for ${decodedTitle}.` : 'No download source available.');
    } catch { showAlert('Download Error', 'Unable to start the download.'); }
    finally { setDownloadingCurrent(false); }
  };

  // ── Modified handleDownloadCurrent to ALWAYS use safeUrl ──────────────────
const handleDownloadCurrent = async () => {
  if (downloadingCurrent) return;
  setDownloadingCurrent(true);
  try {
    let sourceUrl: string | null = null;
    try {
      // Fetch the download API directly to get the safeUrl
      const seasonParam = streamType === 'movie' ? undefined : (season || 1);
      const episodeParam = streamType === 'movie' ? undefined : (ep || 1);
      const url = `/api/download?subject_id=${encodeURIComponent(effectiveSubjectId)}&detail_path=${encodeURIComponent(effectiveDetailPath || '')}` +
        (seasonParam !== undefined ? `&season=${seasonParam}` : '') +
        (episodeParam !== undefined ? `&episode=${episodeParam}` : '');
      const res = await fetch(url);
      const data = await res.json();
      if (data.downloads && data.downloads.length > 0) {
        const best = data.downloads.find((d: any) => d.resolution === '1080p' || d.resolution === 'Best') || data.downloads[0];
        // The server already builds the right download-oriented URL — either
        // a direct, safe omegatech.app link (confirmed via curl to need no
        // proxying) or an already-wrapped fallback proxy link. Use it as-is
        // via toAbsoluteUrl (only the fallback case is ever relative).
        sourceUrl = best ? toAbsoluteUrl(best.safeUrl || best.url) : null;
      }
    } catch {}
    await startDownload({
      id: `${streamType}-dl-${id}${season ? `-s${season}` : ''}${ep ? `-e${ep}` : ''}`,
      mediaId: Number(id) || 0, mediaType: streamType, title: decodedTitle,
      posterUrl: '', rating: 0,
      season: season ? Number(season) : undefined, episode: ep ? Number(ep) : undefined,
      episodeName: episodeLabel || undefined,
      size: sourceUrl ? 'Direct link' : 'Unavailable',
      status: sourceUrl ? 'completed' : 'failed', progress: sourceUrl ? 100 : 0,
      sourceUrl: sourceUrl || undefined,
    });
    if (sourceUrl) await triggerSecureDownload({ url: sourceUrl, fileName: `${decodedTitle}${episodeLabel ? ` ${episodeLabel}` : ''}.mp4`, preResolved: true });
    showAlert(sourceUrl ? 'Download Started' : 'Download Unavailable', sourceUrl ? `Started download for ${decodedTitle}.` : 'No download source available.');
  } catch { showAlert('Download Error', 'Unable to start the download.'); }
  finally { setDownloadingCurrent(false); }
};

  // ── Render player ────────────────────────────────────────────────────────
  const playbackUrl = playingTrailer && trailerVideoKey
    ? `https://www.youtube.com/embed/${encodeURIComponent(trailerVideoKey)}?autoplay=1&playsinline=1&rel=0`
    : resolvedPrimaryUrl;

  const renderWebPlayer = () => {
    if (!playbackUrl) return null;
    if (Platform.OS === 'web') {
      if (isDirectVideoUrl(playbackUrl)) {
        return React.createElement('video' as any, {
          src: playbackUrl, style: styles.webFrame, controls: true, autoPlay: true, playsInline: true,
          onCanPlay: () => setStreamLoaded(true), onError: () => { if (!usingFallback && fallbackStreamUrl) setUsingFallback(true); else setStreamFailed(true); },
        });
      }
      return React.createElement('iframe' as any, {
        src: playbackUrl, style: styles.webFrame, allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
        allowFullScreen: true, frameBorder: '0', onLoad: () => setStreamLoaded(true),
        sandbox: streamType !== 'anime' ? 'allow-scripts allow-same-origin allow-forms allow-presentation' : undefined,
      });
    }
    return (
      <WebView
        ref={webviewRef}
        key={playbackUrl}
        source={{ uri: playbackUrl }}
        style={styles.video}
        allowsFullscreenVideo allowsInlineMediaPlayback
        javaScriptEnabled domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="always" originWhitelist={['*']}
        setSupportMultipleWindows={false}
        injectedJavaScript={finalInjectedScript || undefined}
        onMessage={handleWebViewMessage}
        onShouldStartLoadWithRequest={(req) => {
          // Block any ad or external navigation
          const mainUrl = playbackUrl || '';
          const safeDomains = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com'];
          const isSafe = 
            req.url === mainUrl || 
            safeDomains.some(d => req.url.includes(d)) ||
            req.url.startsWith('data:') || 
            req.url.startsWith('blob:');

          if (AD_BLOCKED_DOMAINS.some(d => req.url.includes(d))) return false;
          if (!isSafe && req.navigationType === 'other') return false;
          return true;
        }}
        onLoadEnd={() => setStreamLoaded(true)}
        onError={() => setStreamFailed(true)}
        onHttpError={() => setStreamFailed(true)}
        startInLoadingState
        renderLoading={() => <PlayerLoading />}
      />
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={Platform.OS !== 'web'} />

      {/* Watch Party Live Banner */}
      {partyActive && partyCode ? (
        <WatchPartyBanner
          partyCode={partyCode}
          isHost={partyHost === 'true'}
          memberCount={partyMemberCount}
          onLeave={() => setPartyActive(false)}
        />
      ) : null}

      {/* Player area with gesture handler */}
      <View
        style={[styles.playerArea, partyActive && { marginTop: 34 }]}
        {...(Platform.OS !== 'web' ? panResponder.panHandlers : {})}
      >
        {renderWebPlayer()}

        {resolvingStream || (!streamLoaded && !streamFailed && playbackUrl) ? <PlayerLoading /> : null}

        {/* Seek indicator overlay */}
        {seekIndicator ? (
          <View style={[styles.seekIndicator, seekIndicator.dir === 'forward' ? styles.seekRight : styles.seekLeft]}>
            <Text style={styles.seekIcon}>{seekIndicator.dir === 'forward' ? '⏩' : '⏪'}</Text>
            <Text style={styles.seekText}>{seekIndicator.secs}s</Text>
          </View>
        ) : null}

        {/* Smart Resume Banner */}
        {showResumeBanner && !playingTrailer ? (
          <View style={styles.resumeBanner}>
            <MaterialIcons name="history" size={18} color={Colors.primary} />
            <Text style={styles.resumeText}>Resume watching?</Text>
            <Pressable style={styles.resumeBtn} onPress={() => setShowResumeBanner(false)}>
              <Text style={styles.resumeBtnText}>Resume</Text>
            </Pressable>
            <Pressable onPress={() => { setSavedProgress(0); setShowResumeBanner(false); AsyncStorage.removeItem(progressKey).catch(() => {}); }}>
              <Text style={styles.startOverText}>Start Over</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Next Episode Banner */}
        {showNextEpisode ? (
          <View style={styles.nextEpisodeBanner}>
            <Text style={styles.nextEpTitle}>Next Episode in {nextEpCountdown}s</Text>
            <View style={styles.nextEpActions}>
              <Pressable style={[styles.nextEpBtn, { backgroundColor: typeColor }]} onPress={() => {
                clearInterval(countdownRef.current!);
                const nextEp = String((parseInt(ep || '1') || 1) + 1);
                router.replace(`/player/${id}?type=${streamType}&ep=${nextEp}&season=${season || '1'}&title=${encodeURIComponent(decodedTitle)}${effectiveSubjectId ? `&subjectId=${effectiveSubjectId}` : ''}${effectiveDetailPath ? `&detailPath=${effectiveDetailPath}` : ''}`);
              }}>
                <MaterialIcons name="skip-next" size={16} color="#fff" />
                <Text style={styles.nextEpBtnText}>Play Now</Text>
              </Pressable>
              <Pressable style={styles.nextEpCancelBtn} onPress={() => { clearInterval(countdownRef.current!); setShowNextEpisode(false); }}>
                <Text style={styles.nextEpCancelText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Stream failed */}
        {streamFailed ? (
          <View style={styles.messageOverlay}>
            <MaterialIcons name="wifi-off" size={44} color={typeColor} />
            <Text style={styles.messageTitle}>Stream needs another source</Text>
            <Text style={styles.messageText}>The current provider didn't start. Try backup or open externally.</Text>
            <View style={styles.messageActions}>
              {fallbackStreamUrl || usingFallback ? (
                <Pressable style={[styles.messageBtn, { backgroundColor: typeColor }]} onPress={handleRetry}>
                  <Text style={styles.messageBtnText}>{usingFallback ? 'Retry' : 'Use backup'}</Text>
                </Pressable>
              ) : null}
              {playbackUrl && !playingTrailer ? (
                <Pressable style={styles.messageSecondaryBtn} onPress={handleOpenExternal}>
                  <Text style={styles.messageSecondaryText}>Open externally</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Controls overlay */}
        {showControls ? (
          <View style={styles.controlsOverlay} pointerEvents="box-none">
            <View style={[styles.topControls, { paddingTop: insets.top || 16 }]}>
              <Pressable onPress={handleBack} hitSlop={8} style={styles.backBtn}>
                <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
              </Pressable>
              <View style={styles.titleArea}>
                <Text style={styles.ctrlTitle} numberOfLines={1}>{decodedTitle}</Text>
                <Text style={styles.ctrlSub} numberOfLines={1}>
                  {[seasonLabel, episodeLabel, playingTrailer ? 'Trailer' : usingFallback ? 'Backup' : (selectedQuality === 'best' ? 'Best' : selectedQuality)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {trailerVideoKey ? (
                <Pressable onPress={playingTrailer ? () => setPlayingTrailer(false) : () => setPlayingTrailer(true)} style={styles.trailerBtn}>
                  <MaterialIcons name={playingTrailer ? 'movie' : 'play-circle-outline'} size={16} color="#fbbf24" />
                  <Text style={styles.trailerBtnText}>{playingTrailer ? 'Movie' : 'Trailer'}</Text>
                </Pressable>
              ) : null}
              {!playingTrailer && availableQualities.length > 0 ? (
                <Pressable onPress={() => setShowQualityModal(true)} style={styles.qualityBtn}>
                  <MaterialIcons name="settings" size={16} color="#fff" />
                  <Text style={styles.qualityBtnText}>{selectedQuality === 'best' ? 'Best' : selectedQuality}</Text>
                </Pressable>
              ) : null}
              {!playingTrailer ? (
                <Pressable onPress={handleDownloadPress} style={[styles.iconBtn, styles.downloadBtn]} disabled={downloadingCurrent}>
                  <MaterialIcons name={downloadingCurrent ? 'sync' : 'download'} size={18} color="#4ade80" />
                </Pressable>
              ) : null}
              <Pressable onPress={handleOpenExternal} style={styles.iconBtn}>
                <MaterialIcons name="open-in-new" size={18} color={Colors.textPrimary} />
              </Pressable>
            </View>

            {/* Bottom controls */}
            <View style={styles.bottomControls}>
              <Pressable style={styles.speedBtn} onPress={() => setShowSpeedMenu(true)}>
                <MaterialIcons name="speed" size={15} color={Colors.textPrimary} />
                <Text style={styles.speedBtnText}>{playbackSpeed === 1 ? 'Normal' : `${playbackSpeed}x`}</Text>
              </Pressable>
              <View style={styles.streamBadge}>
                <MaterialIcons name={streamLoaded ? 'wifi' : 'sync'} size={12} color={typeColor} />
                <Text style={[styles.streamBadgeText, { color: typeColor }]}>{streamLoaded ? 'READY' : 'LOADING'}</Text>
              </View>
              <View style={styles.gestureTip}>
                <Text style={styles.gestureTipText}>← swipe to seek · ↕ volume · double-tap ±10s</Text>
              </View>
            </View>
          </View>
        ) : null}
      </View>

      {/* Speed Menu Modal */}
      <Modal visible={showSpeedMenu} transparent animationType="fade" onRequestClose={() => setShowSpeedMenu(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowSpeedMenu(false)}>
          <View style={styles.speedMenu}>
            <Text style={styles.speedMenuTitle}>Playback Speed</Text>
            {SPEED_OPTIONS.map(opt => (
              <Pressable key={opt.value} style={[styles.speedOption, playbackSpeed === opt.value && styles.speedOptionActive]}
                onPress={() => { setPlaybackSpeed(opt.value); setShowSpeedMenu(false); }}>
                <Text style={[styles.speedOptionText, playbackSpeed === opt.value && styles.speedOptionTextActive]}>{opt.label}</Text>
                {playbackSpeed === opt.value && <MaterialIcons name="check" size={16} color={Colors.primary} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Quality Selection Modal (playback quality) */}
      <Modal visible={showQualityModal} transparent animationType="fade" onRequestClose={() => setShowQualityModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowQualityModal(false)}>
          <View style={styles.qualityMenu}>
            <Text style={styles.qualityMenuTitle}>Select Quality</Text>
            {loadingQualities ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 20 }} />
            ) : availableQualities.length > 0 ? (
              availableQualities.map(q => (
                <Pressable
                  key={q.value}
                  style={[styles.qualityOption, selectedQuality === q.value && styles.qualityOptionActive]}
                  onPress={() => { setSelectedQuality(q.value); setShowQualityModal(false); }}
                >
                  <Text style={[styles.qualityOptionText, selectedQuality === q.value && styles.qualityOptionTextActive]}>{q.label}</Text>
                  {selectedQuality === q.value && <MaterialIcons name="check" size={16} color={Colors.primary} />}
                </Pressable>
              ))
            ) : (
              <Text style={styles.qualityEmpty}>No qualities available</Text>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Download Quality Modal — matches the reference UI: label + file size, tap to start that download */}
      <Modal visible={showDownloadQualityModal} transparent animationType="fade" onRequestClose={() => setShowDownloadQualityModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowDownloadQualityModal(false)}>
          <View style={styles.qualityMenu}>
            <Text style={styles.qualityMenuTitle}>Select Quality</Text>
            {loadingQualities ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 20 }} />
            ) : availableQualities.length > 0 ? (
              availableQualities.map(q => (
                <Pressable
                  key={q.value}
                  style={styles.qualityOption}
                  onPress={() => performDownloadForQuality(q)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <MaterialIcons name="movie" size={18} color="#4ade80" />
                    <Text style={styles.qualityOptionText}>{q.label}</Text>
                  </View>
                  <Text style={[styles.qualityOptionText, { color: Colors.textSecondary, fontSize: 13 }]}>
                    {q.size && q.size !== 'Unknown' ? q.size : ''}
                  </Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.qualityEmpty}>No qualities available</Text>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function PlayerLoading() {
  return (
    <View style={styles.loadingOverlay}>
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={styles.loadingText}>Loading stream...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  playerArea: { flex: 1 },
  video: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' },
  webFrame: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', borderWidth: 0, backgroundColor: '#000' } as any,
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.82)' },
  loadingText: { color: '#aaa', fontSize: FontSizes.sm },
  messageOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.88)', paddingHorizontal: 28 },
  messageTitle: { color: '#fff', fontSize: FontSizes.lg, fontWeight: FontWeights.bold, textAlign: 'center' },
  messageText: { color: '#aaa', fontSize: FontSizes.sm, textAlign: 'center', lineHeight: 20 },
  messageActions: { flexDirection: 'row', gap: 10, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' },
  messageBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radii.md },
  messageBtnText: { color: '#fff', fontSize: FontSizes.sm, fontWeight: FontWeights.bold },
  messageSecondaryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radii.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' },
  messageSecondaryText: { color: '#fff', fontSize: FontSizes.sm },
  controlsOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'space-between' },
  topControls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 },
  backBtn: { padding: 4 },
  titleArea: { flex: 1 },
  ctrlTitle: { color: '#fff', fontSize: FontSizes.base, fontWeight: FontWeights.semibold },
  ctrlSub: { color: '#aaa', fontSize: FontSizes.xs, marginTop: 1 },
  trailerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(251,191,36,0.15)', borderRadius: Radii.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)' },
  trailerBtnText: { color: '#fbbf24', fontSize: FontSizes.xs, fontWeight: FontWeights.semibold },
  qualityBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: Radii.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  qualityBtnText: { color: '#fff', fontSize: FontSizes.xs, fontWeight: FontWeights.semibold },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  downloadBtn: { backgroundColor: 'rgba(74,222,128,0.16)', borderWidth: 1, borderColor: 'rgba(74,222,128,0.42)' },
  bottomControls: { paddingHorizontal: 16, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  speedBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radii.full },
  speedBtnText: { color: '#fff', fontSize: FontSizes.xs, fontWeight: FontWeights.semibold },
  streamBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radii.full },
  streamBadgeText: { fontSize: FontSizes.xs, fontWeight: FontWeights.bold, letterSpacing: 0.8 },
  gestureTip: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: Radii.full },
  gestureTipText: { color: 'rgba(255,255,255,0.4)', fontSize: 9 },
  seekIndicator: { position: 'absolute', top: '40%', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 16, alignItems: 'center', gap: 4 },
  seekLeft: { left: 20 },
  seekRight: { right: 20 },
  seekIcon: { fontSize: 24 },
  seekText: { color: '#fff', fontSize: FontSizes.base, fontWeight: FontWeights.bold },
  resumeBanner: { position: 'absolute', top: 70, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.9)', borderRadius: Radii.md, padding: 12, borderWidth: 1, borderColor: Colors.primary },
  resumeText: { color: '#fff', fontSize: FontSizes.sm, flex: 1 },
  resumeBtn: { backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radii.sm },
  resumeBtnText: { color: '#fff', fontSize: FontSizes.xs, fontWeight: FontWeights.bold },
  startOverText: { color: '#888', fontSize: FontSizes.xs, paddingHorizontal: 6 },
  nextEpisodeBanner: { position: 'absolute', bottom: 50, right: 14, backgroundColor: 'rgba(0,0,0,0.92)', borderRadius: Radii.md, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', minWidth: 180 },
  nextEpTitle: { color: '#fff', fontSize: FontSizes.sm, fontWeight: FontWeights.bold, marginBottom: 10 },
  nextEpActions: { flexDirection: 'row', gap: 8 },
  nextEpBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radii.sm },
  nextEpBtnText: { color: '#fff', fontSize: FontSizes.xs, fontWeight: FontWeights.bold },
  nextEpCancelBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radii.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  nextEpCancelText: { color: '#888', fontSize: FontSizes.xs },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  speedMenu: { backgroundColor: '#1a1a2e', borderRadius: Radii.lg, paddingVertical: 8, minWidth: 200, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  speedMenuTitle: { color: '#888', fontSize: FontSizes.xs, fontWeight: FontWeights.bold, paddingHorizontal: 16, paddingVertical: 8, letterSpacing: 1 },
  speedOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  speedOptionActive: { backgroundColor: 'rgba(124,58,237,0.15)' },
  speedOptionText: { color: '#fff', fontSize: FontSizes.base },
  speedOptionTextActive: { color: Colors.primary, fontWeight: FontWeights.bold },
  qualityMenu: { backgroundColor: '#1a1a2e', borderRadius: Radii.lg, paddingVertical: 8, minWidth: 200, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  qualityMenuTitle: { color: '#888', fontSize: FontSizes.xs, fontWeight: FontWeights.bold, paddingHorizontal: 16, paddingVertical: 8, letterSpacing: 1 },
  qualityOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  qualityOptionActive: { backgroundColor: 'rgba(124,58,237,0.15)' },
  qualityOptionText: { color: '#fff', fontSize: FontSizes.base },
  qualityOptionTextActive: { color: Colors.primary, fontWeight: FontWeights.bold },
  qualityEmpty: { color: '#888', padding: 20, textAlign: 'center' },
});

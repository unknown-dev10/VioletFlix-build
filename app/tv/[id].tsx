import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, FlatList, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Radii, FontSizes, FontWeights, Shadows } from '@/constants/theme';
import { getTVDetails, getTVSeasonDetails, TMDBTVDetail, TMDBEpisode } from '@/services/tmdbService';
import { TMDB_IMAGE } from '@/constants/config';
import { MediaCard } from '@/components/ui/MediaCard';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAlert } from '@/template';
import { SocialShareModal } from '@/components/ui/SocialShareModal';
import { WatchPartyModal } from '@/components/ui/WatchPartyModal';
import { RecoEngine } from '@/services/recoEngine';
import { triggerSecureDownload } from '@/services/secureDownload';
import { apiUrl } from '@/services/providers';
import { useSEO } from '@/hooks/useSEO';

export default function TVDetailScreen() {
  const { id: rawId, subjectId, detailPath, title: qTitle, poster: qPoster, year: qYear, rating: qRating, description: qDescription } = useLocalSearchParams<{
    id?: string | string[];
    subjectId?: string | string[];
    detailPath?: string | string[];
    title?: string | string[];
    poster?: string | string[];
    year?: string | string[];
    rating?: string | string[];
    description?: string | string[];
  }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { addItem, removeItem, checkInWatchlist, addHistoryItem, startDownload } = useWatchlist();

  const [show, setShow] = useState<TMDBTVDetail | null>(null);
  const [episodes, setEpisodes] = useState<TMDBEpisode[]>([]);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inWatchlist, setInWatchlist] = useState(false);

  // Omegatech IDs (state)
  const [subjectIdState, setSubjectIdState] = useState<string | null>(null);
  const [detailPathState, setDetailPathState] = useState<string | null>(null);
  const [isFetchingIds, setIsFetchingIds] = useState(false);

  // Omegatech IDs from URL query
  const omSubjectId = Array.isArray(subjectId) ? subjectId[0] : subjectId;
  const omDetailPath = Array.isArray(detailPath) ? detailPath[0] : detailPath;
  const omTitle = Array.isArray(qTitle) ? qTitle[0] : qTitle;
  const omPoster = Array.isArray(qPoster) ? qPoster[0] : qPoster;
  const omYear = Array.isArray(qYear) ? qYear[0] : qYear;
  const omRating = Array.isArray(qRating) ? qRating[0] : qRating;
  const omDesc = Array.isArray(qDescription) ? qDescription[0] : qDescription;

  // If we have subjectId and detailPath in URL, assume it's an Omegatech result
  const hasOmegatechParams = omSubjectId && omDetailPath;

  // SEO / Open Graph for link previews
  useSEO({
    title: show?.name || show?.original_name || omTitle || 'TV Series',
    description: show?.overview || omDesc || 'Watch this series in HD on VioletFlix — no ads, just entertainment.',
    image: show?.poster_path ? `https://image.tmdb.org/t/p/w780${show.poster_path}` : (omPoster || undefined),
    type: 'video.tv_show',
    year: show?.first_air_date ? show.first_air_date.slice(0, 4) : omYear,
    rating: show?.vote_average,
    genres: show?.genres?.map((g: any) => g.name).join(', '),
  });


  // ─── IMPROVED fetchOmegatechIds with fuzzy matching ──────────────────────
  const fetchOmegatechIds = useCallback(async (title: string, year: string): Promise<{ subjectId: string; detailPath: string } | null> => {
    try {
      const res = await fetch(`/api/omegatech/search?keyword=${encodeURIComponent(title)}`);
      if (!res.ok) throw new Error('Omegatech search failed');
      const data = await res.json();
      if (data.success && data.data?.items?.length > 0) {
        let match = data.data.items.find((item: any) => {
          const itemYear = (item.releaseDate || '').slice(0, 4);
          return itemYear === year && item.title?.toLowerCase() === title.toLowerCase();
        });
        if (!match) {
          const clean = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
          const cleanedTitle = clean(title);
          match = data.data.items.find((item: any) =>
            clean(item.title).includes(cleanedTitle) || cleanedTitle.includes(clean(item.title))
          ) || data.data.items[0];
        }
        if (match) {
          const sid = String(match.subjectId);
          const dp = match.detailPath || null;
          setSubjectIdState(sid);
          setDetailPathState(dp);
          return { subjectId: sid, detailPath: dp };
        }
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const loadShow = useCallback(async () => {
    const showId = Number(id);
    if (!id || !Number.isFinite(showId)) {
      setShow(null);
      setEpisodes([]);
      setError('This series link is invalid.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let data: TMDBTVDetail | null = null;

      if (hasOmegatechParams) {
        // Construct from URL params (Search result) – no TMDB call
        data = {
          id: Number(omSubjectId),
          name: omTitle || 'Untitled',
          original_name: omTitle || 'Untitled',
          poster_path: omPoster || null,
          backdrop_path: null,
          vote_average: parseFloat(omRating || '0') || 0,
          vote_count: 0,
          first_air_date: omYear || '',
          overview: omDesc || 'No description available',
          genre_ids: [],
          popularity: 0,
          number_of_seasons: 1,
          number_of_episodes: 0,
          genres: [],
          tagline: '',
          status: '',
          seasons: [],
          videos: { results: [] },
          credits: { cast: [] },
          similar: { page: 0, results: [], total_pages: 0, total_results: 0 },
          networks: []
        } as TMDBTVDetail;
        setSubjectIdState(omSubjectId);
        setDetailPathState(omDetailPath);
      } else {
        try {
          // TMDB flow (Home screen)
          data = await getTVDetails(showId);
        } catch (tmdbError) {
          console.warn('TMDB fetch failed, falling back to Omegatech search...');
          if (omTitle) {
            const year = omYear || '';
            const ids = await fetchOmegatechIds(omTitle, year);
            if (ids) {
              data = {
                id: Number(ids.subjectId),
                name: omTitle,
                original_name: omTitle,
                poster_path: omPoster || null,
                backdrop_path: null,
                vote_average: parseFloat(omRating || '0') || 0,
                vote_count: 0,
                first_air_date: omYear || '',
                overview: omDesc || 'No description available',
                genre_ids: [],
                popularity: 0,
                number_of_seasons: 1,
                number_of_episodes: 0,
                genres: [],
                tagline: '',
                status: '',
                seasons: [],
                videos: { results: [] },
                credits: { cast: [] },
                similar: { page: 0, results: [], total_pages: 0, total_results: 0 },
                networks: []
              } as TMDBTVDetail;
              setSubjectIdState(ids.subjectId);
              setDetailPathState(ids.detailPath);
            } else {
              throw tmdbError;
            }
          } else {
            throw tmdbError;
          }
        }
      }

      setShow(data);

      try {
        const wl = await checkInWatchlist(`tv-${id}`);
        setInWatchlist(wl);
      } catch {
        setInWatchlist(false);
      }

      if (data.seasons?.length > 0) {
        const firstSeason = data.seasons.find(s => s.season_number > 0) || data.seasons[0];
        setSelectedSeason(firstSeason.season_number);

        try {
          const season = await getTVSeasonDetails(showId, firstSeason.season_number);
          setEpisodes(season.episodes || []);
        } catch {
          setEpisodes([]);
        }
      }
    } catch {
      setShow(null);
      setEpisodes([]);
      setError('Could not load this series.');
    } finally {
      setLoading(false);
    }
  }, [checkInWatchlist, id, hasOmegatechParams, omSubjectId, omDetailPath, omTitle, omPoster, omYear, omRating, omDesc, fetchOmegatechIds]);

  // ─── Pre-fetch Omegatech IDs when show loads ────────────────────────────
  useEffect(() => {
    if (show && !omSubjectId && !omDetailPath) {
      const year = (show.first_air_date || '').slice(0, 4);
      setIsFetchingIds(true);
      fetchOmegatechIds(show.name, year).finally(() => setIsFetchingIds(false));
    }
  }, [show, omSubjectId, omDetailPath, fetchOmegatechIds]);

  useEffect(() => {
    loadShow();
  }, [loadShow]);

  // ─── Modified ensureIds with fallback ──────────────────────────────────────
  const ensureIds = useCallback(async (): Promise<{ subjectId: string; detailPath: string } | null> => {
    if (subjectIdState && detailPathState) {
      return { subjectId: subjectIdState, detailPath: detailPathState };
    }
    if (omSubjectId && omDetailPath) {
      setSubjectIdState(omSubjectId);
      setDetailPathState(omDetailPath);
      return { subjectId: omSubjectId, detailPath: omDetailPath };
    }
    if (show?.name) {
      setIsFetchingIds(true);
      const year = (show.first_air_date || '').slice(0, 4);
      const result = await fetchOmegatechIds(show.name, year);
      setIsFetchingIds(false);
      // ✅ CRITICAL FALLBACK: If Omegatech fails, use the local TMDB ID
      if (!result) {
        console.warn('Omegatech IDs not found, falling back to TMDB ID:', show.id);
        return { subjectId: String(show.id), detailPath: '' };
      }
      return result;
    }
    return null;
  }, [subjectIdState, detailPathState, omSubjectId, omDetailPath, show, fetchOmegatechIds]);

  const handleEpisodePlay = useCallback(async (episode: TMDBEpisode) => {
    if (isFetchingIds) {
      showAlert('Loading', 'Please wait while we load stream sources...');
      return;
    }
    if (!show) return;
    const ids = await ensureIds();
    if (!ids) {
      showAlert('Playback Error', 'Could not find stream source for this title.');
      return;
    }
    try {
      await addHistoryItem({
        id: `tv-${show.id}`, mediaId: show.id, mediaType: 'tv',
        title: show.name || '',
        posterUrl: show.poster_path,
        rating: show.vote_average * 10,
        episode: episode.episode_number, season: selectedSeason, progress: 0,
      });
    } catch {}

    try {
      const queryParams = new URLSearchParams();
      queryParams.set('type', 'tv');
      queryParams.set('ep', String(episode.episode_number));
      queryParams.set('season', String(selectedSeason));
      queryParams.set('title', encodeURIComponent(show.name || ''));
      queryParams.set('subjectId', ids.subjectId);
      queryParams.set('detailPath', ids.detailPath);
      router.push(`/player/${show.id}?${queryParams.toString()}`);
    } catch {
      showAlert('Playback Error', 'Unable to open the player.');
    }
  }, [show, addHistoryItem, router, selectedSeason, showAlert, ensureIds, isFetchingIds]);

  // Quality picker state for episode downloads (mirrors the movie player's
  // download-quality modal, per request to make TV downloads work the same way)
  const [showEpQualityModal, setShowEpQualityModal] = useState(false);
  const [epQualities, setEpQualities] = useState<{ label: string; value: string; url: string; size?: string }[]>([]);
  const [loadingEpQualities, setLoadingEpQualities] = useState(false);
  const [downloadTargetEpisode, setDownloadTargetEpisode] = useState<TMDBEpisode | null>(null);

  const handleEpisodeDownload = useCallback(async (episode: TMDBEpisode) => {
    if (!show) return;
    const ids = await ensureIds();
    if (!ids?.subjectId) {
      showAlert('Download Unavailable', 'No download source available for this title.');
      return;
    }
    setDownloadTargetEpisode(episode);
    setEpQualities([]);
    setLoadingEpQualities(true);
    setShowEpQualityModal(true);
    try {
      const url = apiUrl('/api/download', {
        subject_id: ids.subjectId,
        detail_path: ids.detailPath || '',
        season: selectedSeason,
        episode: episode.episode_number,
      });
      const res = await fetch(url);
      const data = await res.json();
      const qualities = (data.downloads || [])
        .filter((d: any) => d.url && d.resolution)
        .map((d: any) => ({ label: d.resolution, value: d.resolution.toLowerCase(), url: d.safeUrl || d.url, size: d.size }));  // prefer the download-oriented field (safe direct omegatech.app link, or already-wrapped fallback proxy link)
      const unique = qualities.filter((q: any, i: number, self: any[]) => self.findIndex(t => t.value === q.value) === i);
      setEpQualities(unique);
    } catch {
      setEpQualities([]);
    } finally {
      setLoadingEpQualities(false);
    }
  }, [show, selectedSeason, ensureIds, showAlert]);

  const performEpisodeDownload = useCallback(async (q: { label: string; url: string }) => {
    setShowEpQualityModal(false);
    const episode = downloadTargetEpisode;
    if (!show || !episode) return;
    try {
      await startDownload({
        id: `tv-dl-${show.id}-s${selectedSeason}e${episode.episode_number}-${q.label}`,
        mediaId: show.id, mediaType: 'tv',
        title: show.name || '',
        posterUrl: show.poster_path,
        rating: show.vote_average * 10,
        episode: episode.episode_number, season: selectedSeason,
        episodeName: `S${selectedSeason}E${episode.episode_number} - ${episode.name}`,
        size: 'Direct link',
        status: 'completed', progress: 100,
        sourceUrl: q.url,
      });
      await triggerSecureDownload({
        url: q.url,
        fileName: `${show.name || 'show'} S${selectedSeason}E${episode.episode_number} ${q.label}.mp4`,
        preResolved: true,
      });
      showAlert('Download Started', `Started ${q.label} download for S${selectedSeason}E${episode.episode_number}.`);
    } catch {
      showAlert('Download Error', 'Unable to start the download right now.');
    }
  }, [show, selectedSeason, downloadTargetEpisode, startDownload, showAlert]);

  const loadSeason = useCallback(async (seasonNum: number) => {
    setSelectedSeason(seasonNum);
    try {
      const season = await getTVSeasonDetails(Number(id), seasonNum);
      setEpisodes(season.episodes || []);
    } catch {
      showAlert('Error', 'Failed to load season');
    }
  }, [id, showAlert]);

  const toggleWatchlist = useCallback(async () => {
    if (!show) return;
    const itemId = `tv-${show.id}`;
    try {
      if (inWatchlist) {
        await removeItem(itemId);
        setInWatchlist(false);
      } else {
        await addItem({
          id: itemId, mediaId: show.id, mediaType: 'tv',
          title: show.name || '',
          posterUrl: show.poster_path,
          rating: show.vote_average * 10,
          genres: show.genres?.map(g => g.name),
        });
        setInWatchlist(true);
      }
    } catch {
      showAlert('Watchlist Error', 'Unable to update your watchlist.');
    }
  }, [show, inWatchlist, addItem, removeItem, showAlert]);

  const handleWatchNow = useCallback(() => {
    if (isFetchingIds) {
      showAlert('Loading', 'Please wait while we load stream sources...');
      return;
    }
    if (!episodes[0]) {
      showAlert('No Episode', 'No episode is available for this series yet.');
      return;
    }
    handleEpisodePlay(episodes[0]);
  }, [episodes, handleEpisodePlay, showAlert, isFetchingIds]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={Colors.seriesColor} />
      </View>
    );
  }

  if (error || !show) {
    return (
      <View style={styles.errorWrap}>
        <MaterialIcons name="error-outline" size={48} color={Colors.seriesColor} />
        <Text style={styles.errorTitle}>Series did not load</Text>
        <Text style={styles.errorText}>
          {error || 'Series details are unavailable.'}
        </Text>
        <View style={styles.errorActions}>
          <Pressable style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]} onPress={loadShow}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.75 }]} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const backdropUri = show.backdrop_path ? TMDB_IMAGE(show.backdrop_path, 'w1280') : null;
  const posterUri = show.poster_path ? (show.poster_path.startsWith('http') ? show.poster_path : TMDB_IMAGE(show.poster_path, 'w500')) : null;
  const year = (show.first_air_date || '').slice(0, 4);
  const mainSeasons = show.seasons?.filter(s => s.season_number > 0) || [];

  return (
    <ScrollView style={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.backdropWrap}>
        {backdropUri ? (
          <Image source={{ uri: backdropUri }} style={styles.backdrop} contentFit="cover" />
        ) : <View style={[styles.backdrop, styles.backdropFallback]} />}
        <LinearGradient colors={['transparent', Colors.background]} style={styles.backdropGrad} />
      </View>

      <View style={styles.content}>
        <View style={styles.posterRow}>
          {posterUri ? (
            <Image source={{ uri: posterUri }} style={styles.poster} contentFit="cover" />
          ) : null}
          <View style={styles.mainInfo}>
            <Text style={styles.title}>{show.name}</Text>
            {show.tagline ? <Text style={styles.tagline}>{show.tagline}</Text> : null}
            <View style={styles.metaRow}>
              <Text style={styles.metaItem}>{year}</Text>
              {show.number_of_seasons ? (
                <>
                  <View style={styles.dot} />
                  <Text style={styles.metaItem}>{show.number_of_seasons} seasons</Text>
                </>
              ) : null}
              {show.vote_average > 0 ? (
                <>
                  <View style={styles.dot} />
                  <MaterialIcons name="star" size={13} color={Colors.accent} />
                  <Text style={[styles.metaItem, { color: Colors.accent }]}>{show.vote_average.toFixed(1)}</Text>
                </>
              ) : null}
            </View>
            {show.genres?.length > 0 ? (
              <View style={styles.genres}>
                {show.genres.slice(0, 3).map(g => (
                  <View key={g.id} style={styles.genreTag}>
                    <Text style={styles.genreText}>{g.name}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.watchBtn, pressed && { opacity: 0.85 }]}
            onPress={handleWatchNow}
            disabled={isFetchingIds}
          >
            <MaterialIcons name="play-arrow" size={22} color={Colors.textPrimary} />
            <Text style={styles.watchBtnText}>{isFetchingIds ? 'Loading...' : 'Watch Now'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, inWatchlist && styles.iconBtnActive, pressed && { opacity: 0.7 }]}
            onPress={toggleWatchlist}
          >
            <MaterialIcons
              name={inWatchlist ? 'bookmark' : 'bookmark-border'}
              size={22}
              color={inWatchlist ? Colors.seriesColor : Colors.textPrimary}
            />
          </Pressable>
        </View>

        {/* Overview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <Text style={styles.overview}>{show.overview}</Text>
        </View>

        {/* Season Selector */}
        {mainSeasons.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Seasons</Text>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={mainSeasons}
              keyExtractor={s => String(s.id)}
              contentContainerStyle={{ gap: 8 }}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.seasonBtn, selectedSeason === item.season_number && styles.seasonBtnActive]}
                  onPress={() => loadSeason(item.season_number)}
                >
                  <Text style={[styles.seasonText, selectedSeason === item.season_number && styles.seasonTextActive]}>
                    S{item.season_number}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        ) : null}

        {/* Episodes */}
        {episodes.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Season {selectedSeason} Episodes</Text>
            {episodes.map(ep => {
              const stillUri = ep.still_path ? TMDB_IMAGE(ep.still_path, 'w300') : null;
              return (
                <View
                  key={ep.id}
                  style={styles.epCard}
                >
                  <View style={styles.epStill}>
                    {stillUri ? (
                      <Image source={{ uri: stillUri }} style={styles.stillImg} contentFit="cover" />
                    ) : (
                      <View style={[styles.stillImg, styles.noStill]}>
                        <MaterialIcons name="play-circle-outline" size={28} color={Colors.textMuted} />
                      </View>
                    )}
                    <View style={styles.playOverlay}>
                      <MaterialIcons name="play-circle-filled" size={32} color="rgba(255,255,255,0.85)" />
                    </View>
                  </View>
                  <View style={styles.epInfo}>
                    <Text style={styles.epNum}>Episode {ep.episode_number}</Text>
                    <Text style={styles.epTitle} numberOfLines={1}>{ep.name}</Text>
                    <Text style={styles.epOverview} numberOfLines={2}>{ep.overview}</Text>
                    <View style={styles.epMeta}>
                      {ep.runtime ? <Text style={styles.epMetaText}>{ep.runtime}m</Text> : null}
                      {ep.vote_average > 0 ? (
                        <View style={styles.epRating}>
                          <MaterialIcons name="star" size={10} color={Colors.accent} />
                          <Text style={styles.epRatingText}>{ep.vote_average.toFixed(1)}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.epActions}>
                    <Pressable style={styles.epActionBtn} onPress={() => handleEpisodePlay(ep)} disabled={isFetchingIds}>
                      <MaterialIcons name="play-arrow" size={16} color={Colors.textPrimary} />
                      <Text style={styles.epActionText}>{isFetchingIds ? '...' : 'Play'}</Text>
                    </Pressable>
                    <Pressable style={[styles.epActionBtn, styles.epDownloadAction]} onPress={() => handleEpisodeDownload(ep)}>
                      <MaterialIcons name="download" size={16} color={Colors.downloadColor} />
                      <Text style={[styles.epActionText, { color: Colors.downloadColor }]}>Download</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Similar */}
        {show.similar?.results?.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Similar Shows</Text>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={show.similar.results.slice(0, 10)}
              keyExtractor={i => String(i.id)}
              renderItem={({ item }) => (
                <MediaCard
                  id={item.id}
                  title={item.name || item.title || ''}
                  posterUrl={item.poster_path}
                  rating={item.vote_average * 10}
                  type="tv"
                  onPress={() => router.push(`/tv/${item.id}`)}
                />
              )}
            />
          </View>
        ) : null}

        <View style={{ height: insets.bottom + Spacing.xl }} />

        {/* Episode download quality picker */}
        <Modal visible={showEpQualityModal} transparent animationType="fade" onRequestClose={() => setShowEpQualityModal(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowEpQualityModal(false)}>
            <View style={styles.qualityMenu}>
              <Text style={styles.qualityMenuTitle}>Select Quality</Text>
              {loadingEpQualities ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 20 }} />
              ) : epQualities.length > 0 ? (
                epQualities.map(q => (
                  <Pressable key={q.value} style={styles.qualityOption} onPress={() => performEpisodeDownload(q)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialIcons name="movie" size={18} color={Colors.downloadColor} />
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  qualityMenu: { backgroundColor: '#1a1a2e', borderRadius: Radii.lg, paddingVertical: 8, minWidth: 240, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  qualityMenuTitle: { color: '#888', fontSize: FontSizes.xs, fontWeight: FontWeights.bold, paddingHorizontal: 16, paddingVertical: 8, letterSpacing: 1 },
  qualityOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  qualityOptionText: { color: Colors.textPrimary, fontSize: FontSizes.sm, fontWeight: FontWeights.medium },
  qualityEmpty: { color: Colors.textSecondary, fontSize: FontSizes.sm, paddingHorizontal: 16, paddingVertical: 20, textAlign: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: Spacing.xl, backgroundColor: Colors.background },
  errorTitle: { color: Colors.textPrimary, fontSize: FontSizes.lg, fontWeight: FontWeights.bold, textAlign: 'center' },
  errorText: { color: Colors.textSecondary, fontSize: FontSizes.md, lineHeight: 22, textAlign: 'center' },
  errorActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 },
  retryBtn: { backgroundColor: Colors.seriesColor, borderRadius: Radii.md, paddingHorizontal: 18, paddingVertical: 11 },
  retryBtnText: { color: Colors.textPrimary, fontSize: FontSizes.sm, fontWeight: FontWeights.bold },
  backBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal: 18, paddingVertical: 11, backgroundColor: Colors.surfaceElevated },
  backBtnText: { color: Colors.textPrimary, fontSize: FontSizes.sm, fontWeight: FontWeights.semibold },
  backdropWrap: { height: 260 },
  backdrop: { width: '100%', height: '100%' },
  backdropFallback: { backgroundColor: Colors.surfaceElevated },
  backdropGrad: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 160 },
  content: { paddingHorizontal: Spacing.md },
  posterRow: { flexDirection: 'row', gap: Spacing.md, marginTop: -60, marginBottom: Spacing.md },
  poster: { width: 110, height: 165, borderRadius: Radii.md, ...Shadows.card },
  mainInfo: { flex: 1, paddingTop: 40 },
  title: { color: Colors.textPrimary, fontSize: FontSizes.xl, fontWeight: FontWeights.black, lineHeight: 26 },
  tagline: { color: Colors.textMuted, fontSize: FontSizes.sm, fontStyle: 'italic', marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, flexWrap: 'wrap' },
  metaItem: { color: Colors.textSecondary, fontSize: FontSizes.sm },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.textMuted },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  genreTag: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(52,152,219,0.1)', borderRadius: Radii.full, borderWidth: 1, borderColor: 'rgba(52,152,219,0.3)' },
  genreText: { color: Colors.seriesColor, fontSize: FontSizes.xs },
  actions: { flexDirection: 'row', gap: 10, marginBottom: Spacing.lg },
  watchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.seriesColor, borderRadius: Radii.md, paddingVertical: 12 },
  watchBtnText: { color: Colors.textPrimary, fontSize: FontSizes.md, fontWeight: FontWeights.bold },
  iconBtn: { width: 48, height: 48, borderRadius: Radii.md, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  iconBtnActive: { borderColor: Colors.seriesColor },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSizes.lg, fontWeight: FontWeights.bold, marginBottom: Spacing.sm },
  overview: { color: Colors.textSecondary, fontSize: FontSizes.base, lineHeight: 24 },
  seasonBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceCard },
  seasonBtnActive: { backgroundColor: Colors.seriesColor, borderColor: Colors.seriesColor },
  seasonText: { color: Colors.textSecondary, fontSize: FontSizes.sm, fontWeight: FontWeights.semibold },
  seasonTextActive: { color: Colors.textPrimary },
  epCard: { flexDirection: 'row', gap: 10, marginBottom: 12, backgroundColor: Colors.surfaceCard, borderRadius: Radii.md, padding: 8, borderWidth: 1, borderColor: Colors.border },
  epStill: { width: 112, height: 63, borderRadius: Radii.sm, overflow: 'hidden', position: 'relative' },
  stillImg: { width: 112, height: 63 },
  noStill: { backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  playOverlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  epInfo: { flex: 1 },
  epNum: { color: Colors.textMuted, fontSize: FontSizes.xs, marginBottom: 2 },
  epTitle: { color: Colors.textPrimary, fontSize: FontSizes.sm, fontWeight: FontWeights.semibold, marginBottom: 3 },
  epOverview: { color: Colors.textMuted, fontSize: FontSizes.xs, lineHeight: 16 },
  epMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  epMetaText: { color: Colors.textMuted, fontSize: FontSizes.xs },
  epRating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  epRatingText: { color: Colors.accent, fontSize: FontSizes.xs },
  epActions: { justifyContent: 'center', gap: 6 },
  epActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 86, paddingHorizontal: 8, paddingVertical: 7, borderRadius: Radii.sm, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  epDownloadAction: { borderColor: 'rgba(46,204,113,0.35)', backgroundColor: 'rgba(46,204,113,0.08)' },
  epActionText: { color: Colors.textPrimary, fontSize: FontSizes.xs, fontWeight: FontWeights.bold },
});

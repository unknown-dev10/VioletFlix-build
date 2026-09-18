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
import { getMovieDetails, TMDBMovieDetail } from '@/services/tmdbService';
import { TMDB_IMAGE } from '@/constants/config';
import { MediaCard } from '@/components/ui/MediaCard';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAlert } from '@/template';
import { triggerSecureDownload } from '@/services/secureDownload';
import { apiUrl } from '@/services/providers';
import { SocialShareModal } from '@/components/ui/SocialShareModal';
import { WatchPartyModal } from '@/components/ui/WatchPartyModal';
import { RecoEngine } from '@/services/recoEngine';
import { useSEO } from '@/hooks/useSEO';

export default function MovieDetailScreen() {
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

  const [movie, setMovie] = useState<TMDBMovieDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showPartyModal, setShowPartyModal] = useState(false);

  // Omegatech IDs (state)
  const [subjectIdState, setSubjectIdState] = useState<string | null>(null);
  const [detailPathState, setDetailPathState] = useState<string | null>(null);
  const [isFetchingIds, setIsFetchingIds] = useState(false);

  // Omegatech IDs from URL query (for Search)
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
    title: movie?.title || omTitle || 'Movie',
    description: movie?.overview || omDesc || 'Watch this movie in HD on VioletFlix — no ads, just entertainment.',
    image: movie?.poster_path ? `https://image.tmdb.org/t/p/w780${movie.poster_path}` : (omPoster || undefined),
    type: 'video.movie',
    year: movie?.release_date ? movie.release_date.slice(0, 4) : omYear,
    rating: movie?.vote_average,
    genres: movie?.genres?.map((g: any) => g.name).join(', '),
  });


  // ─── IMPROVED fetchOmegatechIds with fuzzy matching ──────────────────────
  const fetchOmegatechIds = useCallback(async (title: string, year: string): Promise<{ subjectId: string; detailPath: string } | null> => {
    try {
      const res = await fetch(`/api/omegatech/search?keyword=${encodeURIComponent(title)}`);
      if (!res.ok) throw new Error('Omegatech search failed');
      const data = await res.json();
      if (data.success && data.data?.items?.length > 0) {
        // Exact match first
        let match = data.data.items.find((item: any) => {
          const itemYear = (item.releaseDate || '').slice(0, 4);
          return itemYear === year && item.title?.toLowerCase() === title.toLowerCase();
        });
        // Fuzzy fallback if no exact match
        if (!match) {
          const clean = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
          const cleanedTitle = clean(title);
          match = data.data.items.find((item: any) =>
            clean(item.title).includes(cleanedTitle) || cleanedTitle.includes(clean(item.title))
          ) || data.data.items[0]; // ultimate fallback
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

  const loadMovie = useCallback(async () => {
    const movieId = Number(id);
    if (!id || !Number.isFinite(movieId)) {
      setMovie(null);
      setError('This movie link is invalid.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      let data: TMDBMovieDetail | null = null;

      if (hasOmegatechParams) {
        // Construct from URL params (Search result) – no TMDB call
        data = {
          id: Number(omSubjectId),
          title: omTitle || 'Untitled',
          original_title: omTitle || 'Untitled',
          poster_path: omPoster || null,
          backdrop_path: null,
          vote_average: parseFloat(omRating || '0') || 0,
          vote_count: 0,
          release_date: omYear || '',
          overview: omDesc || 'No description available',
          genre_ids: [],
          popularity: 0,
          runtime: 0,
          genres: [],
          tagline: '',
          status: '',
          budget: 0,
          revenue: 0,
          videos: { results: [] },
          credits: { cast: [], crew: [] },
          similar: { page: 0, results: [], total_pages: 0, total_results: 0 },
          recommendations: { page: 0, results: [], total_pages: 0, total_results: 0 }
        } as TMDBMovieDetail;
        setSubjectIdState(omSubjectId);
        setDetailPathState(omDetailPath);
      } else {
        try {
          // TMDB flow (Home screen)
          data = await getMovieDetails(movieId);
          if (data?.id) {
            const genreNames = data.genres?.map((g: any) => g.name).join(', ');
            RecoEngine.track(String(data.id), genreNames, 'movie').catch(() => {});
          }
        } catch (tmdbError) {
          console.warn('TMDB fetch failed, falling back to Omegatech search...');
          // If TMDB fails, try to find Omegatech IDs using the title from URL params
          if (omTitle) {
            const year = omYear || '';
            const ids = await fetchOmegatechIds(omTitle, year);
            if (ids) {
              // Construct a minimal movie object from search params
              data = {
                id: Number(ids.subjectId),
                title: omTitle,
                original_title: omTitle,
                poster_path: omPoster || null,
                backdrop_path: null,
                vote_average: parseFloat(omRating || '0') || 0,
                vote_count: 0,
                release_date: omYear || '',
                overview: omDesc || 'No description available',
                genre_ids: [],
                popularity: 0,
                runtime: 0,
                genres: [],
                tagline: '',
                status: '',
                budget: 0,
                revenue: 0,
                videos: { results: [] },
                credits: { cast: [], crew: [] },
                similar: { page: 0, results: [], total_pages: 0, total_results: 0 },
                recommendations: { page: 0, results: [], total_pages: 0, total_results: 0 }
              } as TMDBMovieDetail;
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

      setMovie(data);

      try {
        const wl = await checkInWatchlist(`movie-${id}`);
        setInWatchlist(wl);
      } catch {
        setInWatchlist(false);
      }
    } catch (e: any) {
      setMovie(null);
      setError('Could not load this movie.');
    } finally {
      setLoading(false);
    }
  }, [checkInWatchlist, id, hasOmegatechParams, omSubjectId, omDetailPath, omTitle, omPoster, omYear, omRating, omDesc, fetchOmegatechIds]);

  // ─── Pre-fetch Omegatech IDs when movie loads (if not already present) ──
  useEffect(() => {
    if (movie && !omSubjectId && !omDetailPath) {
      const year = (movie.release_date || '').slice(0, 4);
      setIsFetchingIds(true);
      fetchOmegatechIds(movie.title, year).finally(() => setIsFetchingIds(false));
    }
  }, [movie, omSubjectId, omDetailPath, fetchOmegatechIds]);

  useEffect(() => {
    loadMovie();
  }, [loadMovie]);

  // ─── Modified ensureIds with fallback ──────────────────────────────────────
  const ensureIds = useCallback(async (): Promise<{ subjectId: string; detailPath: string } | null> => {
    // If we already have IDs, return them
    if (subjectIdState && detailPathState) {
      return { subjectId: subjectIdState, detailPath: detailPathState };
    }
    // If we have URL params, use them (Search flow)
    if (omSubjectId && omDetailPath) {
      setSubjectIdState(omSubjectId);
      setDetailPathState(omDetailPath);
      return { subjectId: omSubjectId, detailPath: omDetailPath };
    }
    // Otherwise, try to fetch (Home flow) – but pre-fetch should have already run
    if (movie?.title) {
      setIsFetchingIds(true);
      const year = (movie.release_date || '').slice(0, 4);
      const result = await fetchOmegatechIds(movie.title, year);
      setIsFetchingIds(false);
      // ✅ CRITICAL FALLBACK: If Omegatech fails, use the local TMDB ID so the player still works
      if (!result) {
        console.warn('Omegatech IDs not found, falling back to TMDB ID:', movie.id);
        return { subjectId: String(movie.id), detailPath: '' };
      }
      return result;
    }
    return null;
  }, [subjectIdState, detailPathState, omSubjectId, omDetailPath, movie, fetchOmegatechIds]);

  const toggleWatchlist = useCallback(async () => {
    if (!movie) return;
    const itemId = `movie-${movie.id}`;
    try {
      if (inWatchlist) {
        await removeItem(itemId);
        setInWatchlist(false);
      } else {
        await addItem({
          id: itemId, mediaId: movie.id, mediaType: 'movie',
          title: movie.title || '',
          posterUrl: movie.poster_path,
          rating: movie.vote_average * 10,
          year: (movie.release_date || '').slice(0, 4),
          genres: movie.genres?.map(g => g.name),
        });
        setInWatchlist(true);
      }
    } catch {
      showAlert('Watchlist Error', 'Unable to update watchlist.');
    }
  }, [movie, inWatchlist, addItem, removeItem, showAlert]);

  const handleWatch = useCallback(async () => {
    if (isFetchingIds) {
      showAlert('Loading', 'Please wait while we load stream sources...');
      return;
    }
    if (!movie) return;
    const ids = await ensureIds();
    if (!ids) {
      showAlert('Playback Error', 'Could not find stream source for this title.');
      return;
    }
    const trailer = movie.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
    try {
      await addHistoryItem({
        id: `movie-${movie.id}`, mediaId: movie.id, mediaType: 'movie',
        title: movie.title || '',
        posterUrl: movie.poster_path,
        rating: movie.vote_average * 10,
        progress: 0,
      });
    } catch {}
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('type', 'movie');
      queryParams.set('title', encodeURIComponent(movie.title || ''));
      if (trailer) queryParams.set('trailerKey', trailer.key);
      queryParams.set('subjectId', ids.subjectId);
      queryParams.set('detailPath', ids.detailPath);
      router.push(`/player/${movie.id}?${queryParams.toString()}`);
    } catch {
      showAlert('Playback Error', 'Unable to open player.');
    }
  }, [movie, addHistoryItem, router, showAlert, ensureIds, isFetchingIds]);

  const handleWatchTrailer = useCallback(async () => {
    if (!movie) return;
    const trailer = movie.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
    if (!trailer) { showAlert('No Trailer', 'No trailer available'); return; }
    try {
      router.push(`/player/${movie.id}?type=movie&title=${encodeURIComponent(movie.title || 'Movie trailer')}&trailerKey=${trailer.key}&trailer=1`);
    } catch { showAlert('Trailer Error', 'Unable to open trailer.'); }
  }, [movie, router, showAlert]);

  // Quality picker state for downloads (mirrors TV/anime)
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [qualities, setQualities] = useState<{ label: string; value: string; url: string; size?: string }[]>([]);
  const [loadingQualities, setLoadingQualities] = useState(false);

  const handleDownload = useCallback(async () => {
    if (!movie) return;
    const ids = await ensureIds();
    if (!ids?.subjectId) {
      showAlert('Download Unavailable', 'No download source available for this title.');
      return;
    }
    setQualities([]);
    setLoadingQualities(true);
    setShowQualityModal(true);
    try {
      const url = apiUrl('/api/download', {
        subject_id: ids.subjectId,
        detail_path: ids.detailPath || '',
      });
      const res = await fetch(url);
      const data = await res.json();
      const items = (data.downloads || [])
        .filter((d: any) => d.url && d.resolution)
        .map((d: any) => ({ label: d.resolution, value: d.resolution.toLowerCase(), url: d.safeUrl || d.url, size: d.size }));  // prefer the download-oriented field (safe direct omegatech.app link, or already-wrapped fallback proxy link)
      const unique = items.filter((q: any, i: number, self: any[]) => self.findIndex(t => t.value === q.value) === i);
      setQualities(unique);
    } catch {
      setQualities([]);
    } finally {
      setLoadingQualities(false);
    }
  }, [movie, ensureIds, showAlert]);

  const performDownload = useCallback(async (q: { label: string; url: string }) => {
    setShowQualityModal(false);
    if (!movie) return;
    try {
      await startDownload({
        id: `movie-dl-${movie.id}-${q.label}`,
        mediaId: movie.id, mediaType: 'movie',
        title: movie.title || '',
        posterUrl: movie.poster_path,
        rating: movie.vote_average * 10,
        size: 'Direct link',
        status: 'completed',
        progress: 100,
        sourceUrl: q.url,
      });
      await triggerSecureDownload({ url: q.url, fileName: `${movie.title || 'movie'} ${q.label}.mp4`, preResolved: true });
      showAlert('Download Started', `Started ${q.label} download for "${movie.title}".`);
    } catch {
      showAlert('Download Error', 'Unable to start download.');
    }
  }, [movie, startDownload, showAlert]);

  if (loading) return <View style={styles.loadingWrap}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (error || !movie) {
    return (
      <View style={styles.errorWrap}>
        <MaterialIcons name="error-outline" size={48} color={Colors.primary} />
        <Text style={styles.errorTitle}>Movie did not load</Text>
        <Text style={styles.errorText}>{error || 'Could not load this movie.'}</Text>
        <View style={styles.errorActions}>
          <Pressable style={styles.retryBtn} onPress={loadMovie}><Text style={styles.retryBtnText}>Try Again</Text></Pressable>
          <Pressable style={styles.backBtn} onPress={() => router.back()}><Text style={styles.backBtnText}>Go Back</Text></Pressable>
        </View>
      </View>
    );
  }

  const backdropUri = movie.backdrop_path ? TMDB_IMAGE(movie.backdrop_path, 'w1280') : null;
  const posterUri = movie.poster_path ? (movie.poster_path.startsWith('http') ? movie.poster_path : TMDB_IMAGE(movie.poster_path, 'w500')) : null;
  const trailer = movie.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
  const runtime = movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : 'N/A';
  const year = (movie.release_date || '').slice(0, 4);

  return (
    <ScrollView style={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.backdropWrap}>
        {backdropUri ? <Image source={{ uri: backdropUri }} style={styles.backdrop} contentFit="cover" /> : <View style={[styles.backdrop, styles.backdropFallback]} />}
        <LinearGradient colors={['transparent', Colors.background]} style={styles.backdropGrad} />
      </View>
      <View style={styles.content}>
        <View style={styles.posterRow}>
          {posterUri ? <Image source={{ uri: posterUri }} style={styles.poster} contentFit="cover" /> : null}
          <View style={styles.mainInfo}>
            <Text style={styles.title}>{movie.title}</Text>
            {movie.tagline ? <Text style={styles.tagline}>{movie.tagline}</Text> : null}
            <View style={styles.metaRow}>
              <Text style={styles.metaItem}>{year}</Text>
              <View style={styles.dot} />
              <Text style={styles.metaItem}>{runtime}</Text>
              {movie.vote_average > 0 ? (
                <>
                  <View style={styles.dot} />
                  <MaterialIcons name="star" size={13} color={Colors.accent} />
                  <Text style={[styles.metaItem, { color: Colors.accent }]}>{movie.vote_average.toFixed(1)}</Text>
                </>
              ) : null}
            </View>
            {movie.genres?.length > 0 ? (
              <View style={styles.genres}>
                {movie.genres.slice(0, 3).map(g => (
                  <View key={g.id} style={styles.genreTag}>
                    <Text style={styles.genreText}>{g.name}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable style={styles.watchBtn} onPress={handleWatch} disabled={isFetchingIds}>
            <MaterialIcons name="play-arrow" size={22} color={Colors.textPrimary} />
            <Text style={styles.watchBtnText}>{isFetchingIds ? 'Loading...' : 'Watch Now'}</Text>
          </Pressable>
          {trailer ? (
            <Pressable style={styles.trailerBtn} onPress={handleWatchTrailer}>
              <MaterialIcons name="movie" size={18} color={Colors.accent} />
              <Text style={styles.trailerBtnText}>Trailer</Text>
            </Pressable>
          ) : null}
          <Pressable style={[styles.iconBtn, inWatchlist && styles.iconBtnActive]} onPress={toggleWatchlist}>
            <MaterialIcons name={inWatchlist ? 'bookmark' : 'bookmark-border'} size={22} color={inWatchlist ? Colors.primary : Colors.textPrimary} />
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={handleDownload}>
            <MaterialIcons name="download" size={22} color={Colors.downloadColor} />
          </Pressable>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <Text style={styles.overview}>{movie.overview}</Text>
        </View>
        {movie.credits?.cast?.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cast</Text>
            <FlatList
              horizontal showsHorizontalScrollIndicator={false}
              data={movie.credits.cast.slice(0, 15)}
              keyExtractor={c => String(c.id)}
              contentContainerStyle={{ gap: 12 }}
              renderItem={({ item }) => {
                const profileUri = item.profile_path ? TMDB_IMAGE(item.profile_path, 'w185') : null;
                const initials = (item.name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
                return (
                  <View style={styles.castItem}>
                    <View style={styles.castAvatar}>
                      {profileUri ? <Image source={{ uri: profileUri }} style={styles.castImg} contentFit="cover" /> : (
                        <View style={styles.castAvatarFallback}><Text style={styles.castInitials}>{initials}</Text></View>
                      )}
                    </View>
                    <Text style={styles.castName} numberOfLines={2}>{item.name}</Text>
                    {item.character ? <Text style={styles.castRole} numberOfLines={1}>{item.character}</Text> : null}
                  </View>
                );
              }}
            />
          </View>
        ) : null}
        {movie.recommendations?.results?.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>You May Also Like</Text>
            <FlatList
              horizontal showsHorizontalScrollIndicator={false}
              data={movie.recommendations.results.slice(0, 10)}
              keyExtractor={i => String(i.id)}
              renderItem={({ item }) => (
                <MediaCard
                  id={item.id}
                  title={item.title || item.name || ''}
                  posterUrl={item.poster_path}
                  rating={item.vote_average * 10}
                  year={(item.release_date || '').slice(0, 4)}
                  type="movie"
                  onPress={() => router.push(`/movie/${item.id}`)}
                />
              )}
            />
          </View>
        ) : null}
        <View style={{ height: insets.bottom + Spacing.xl }} />
      </View>
      <SocialShareModal visible={showShareModal} onClose={() => setShowShareModal(false)} title={movie?.title || ''} type="Movie" year={(movie?.release_date || '').slice(0, 4)} posterPath={movie?.poster_path} mediaId={movie?.id} />
      <WatchPartyModal visible={showPartyModal} onClose={() => setShowPartyModal(false)} onStartParty={(code, isHost) => router.push(`/player/${movie?.id}?type=movie&title=${encodeURIComponent(movie?.title || '')}&partyCode=${code}&partyHost=${isHost}`)} movieTitle={movie?.title} posterPath={movie?.poster_path} mediaId={String(movie?.id)} />

      {/* Download quality picker */}
      <Modal visible={showQualityModal} transparent animationType="fade" onRequestClose={() => setShowQualityModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowQualityModal(false)}>
          <View style={styles.qualityMenu}>
            <Text style={styles.qualityMenuTitle}>Select Quality</Text>
            {loadingQualities ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 20 }} />
            ) : qualities.length > 0 ? (
              qualities.map(q => (
                <Pressable key={q.value} style={styles.qualityOption} onPress={() => performDownload(q)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <MaterialIcons name="movie" size={18} color={Colors.primary} />
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
  retryBtn: { backgroundColor: Colors.primary, borderRadius: Radii.md, paddingHorizontal: 18, paddingVertical: 11 },
  retryBtnText: { color: Colors.textPrimary, fontSize: FontSizes.sm, fontWeight: FontWeights.bold },
  backBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal: 18, paddingVertical: 11, backgroundColor: Colors.surfaceElevated },
  backBtnText: { color: Colors.textPrimary, fontSize: FontSizes.sm, fontWeight: FontWeights.semibold },
  backdropWrap: { height: 260, position: 'relative' },
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
  genreTag: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: Colors.surfaceElevated, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border },
  genreText: { color: Colors.textSecondary, fontSize: FontSizes.xs },
  actions: { flexDirection: 'row', gap: 10, marginBottom: Spacing.lg },
  watchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radii.md, paddingVertical: 12 },
  watchBtnText: { color: Colors.textPrimary, fontSize: FontSizes.md, fontWeight: FontWeights.bold },
  trailerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 12, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.accent, backgroundColor: 'rgba(255,215,0,0.08)' },
  trailerBtnText: { color: Colors.accent, fontSize: FontSizes.sm, fontWeight: FontWeights.semibold },
  iconBtn: { width: 48, height: 48, borderRadius: Radii.md, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  iconBtnActive: { borderColor: Colors.primary },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSizes.lg, fontWeight: FontWeights.bold, marginBottom: Spacing.sm },
  overview: { color: Colors.textSecondary, fontSize: FontSizes.base, lineHeight: 24 },
  castItem: { width: 84, alignItems: 'center', gap: 4 },
  castAvatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', marginBottom: 4, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(124,58,237,0.3)' },
  castAvatarFallback: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(124,58,237,0.18)', alignItems: 'center', justifyContent: 'center' },
  castInitials: { color: '#a78bfa', fontSize: 20, fontWeight: FontWeights.black },
  castImg: { width: 68, height: 68 },
  castName: { color: Colors.textPrimary, fontSize: FontSizes.xs, textAlign: 'center', fontWeight: FontWeights.bold, lineHeight: 15 },
  castRole: { color: Colors.textMuted, fontSize: 9, textAlign: 'center', fontStyle: 'italic' },
});

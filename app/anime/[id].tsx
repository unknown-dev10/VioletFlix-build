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
import { getAnimeDetail, AniListMedia } from '@/services/anilistService';
import { AnimeCard } from '@/components/ui/AnimeCard';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAlert } from '@/template';
import { triggerSecureDownload } from '@/services/secureDownload';
import { apiUrl } from '@/services/providers';

export default function AnimeDetailScreen() {
  const { id: rawId, subjectId, detailPath, title: qTitle, poster: qPoster } = useLocalSearchParams<{
    id?: string | string[];
    subjectId?: string | string[];
    detailPath?: string | string[];
    title?: string | string[];
    poster?: string | string[];
  }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const { addItem, removeItem, checkInWatchlist, addHistoryItem, startDownload } = useWatchlist();

  const [anime, setAnime] = useState<AniListMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [selectedEp, setSelectedEp] = useState(1);

  // Omegatech IDs (state)
  const [subjectIdState, setSubjectIdState] = useState<string | null>(null);
  const [detailPathState, setDetailPathState] = useState<string | null>(null);
  const [isFetchingIds, setIsFetchingIds] = useState(false);

  // Omegatech IDs from URL query
  const omSubjectId = Array.isArray(subjectId) ? subjectId[0] : subjectId;
  const omDetailPath = Array.isArray(detailPath) ? detailPath[0] : detailPath;
  const omTitle = Array.isArray(qTitle) ? qTitle[0] : qTitle;

  // If we have subjectId and detailPath in URL, assume it's an Omegatech result
  const hasOmegatechParams = omSubjectId && omDetailPath;

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

  const loadAnime = useCallback(async () => {
    const animeId = Number(id);
    if (!id || !Number.isFinite(animeId)) {
      setAnime(null);
      setError('This anime link is invalid.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let data: AniListMedia | null = null;

      if (hasOmegatechParams) {
        // Construct from URL params (Search result) – no AniList call
        data = {
          id: Number(omSubjectId),
          idMal: null,
          title: { romaji: omTitle || 'Untitled', english: omTitle || null },
          coverImage: { large: '', extraLarge: '', color: null },
          bannerImage: null,
          episodes: null,
          averageScore: null,
          popularity: 0,
          genres: [],
          description: null,
          startDate: { year: null },
          endDate: { year: null },
          status: '',
          season: null,
          seasonYear: null,
          format: null,
          duration: null,
          studios: { nodes: [] },
          nextAiringEpisode: null,
        } as AniListMedia;
        setSubjectIdState(omSubjectId);
        setDetailPathState(omDetailPath);
      } else {
        try {
          data = await getAnimeDetail(animeId);
        } catch (animeError) {
          console.warn('AniList fetch failed, falling back to Omegatech search...');
          if (omTitle) {
            const ids = await fetchOmegatechIds(omTitle, '');
            if (ids) {
              data = {
                id: Number(ids.subjectId),
                idMal: null,
                title: { romaji: omTitle, english: omTitle },
                coverImage: { large: '', extraLarge: '', color: null },
                bannerImage: null,
                episodes: null,
                averageScore: null,
                popularity: 0,
                genres: [],
                description: null,
                startDate: { year: null },
                endDate: { year: null },
                status: '',
                season: null,
                seasonYear: null,
                format: null,
                duration: null,
                studios: { nodes: [] },
                nextAiringEpisode: null,
              } as AniListMedia;
              setSubjectIdState(ids.subjectId);
              setDetailPathState(ids.detailPath);
            } else {
              throw animeError;
            }
          } else {
            throw animeError;
          }
        }
      }

      setAnime(data);

      try {
        const wl = await checkInWatchlist(`anime-${id}`);
        setInWatchlist(wl);
      } catch {
        setInWatchlist(false);
      }
    } catch {
      setAnime(null);
      setError('Could not load this anime.');
    } finally {
      setLoading(false);
    }
  }, [checkInWatchlist, id, hasOmegatechParams, omSubjectId, omDetailPath, omTitle, fetchOmegatechIds]);

  // ─── Pre-fetch Omegatech IDs when anime loads ────────────────────────────
  useEffect(() => {
    if (anime && !omSubjectId && !omDetailPath) {
      const title = anime.title.english || anime.title.romaji;
      const year = anime.seasonYear ? String(anime.seasonYear) : '';
      setIsFetchingIds(true);
      fetchOmegatechIds(title, year).finally(() => setIsFetchingIds(false));
    }
  }, [anime, omSubjectId, omDetailPath, fetchOmegatechIds]);

  useEffect(() => {
    loadAnime();
  }, [loadAnime]);

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
    if (anime?.title) {
      setIsFetchingIds(true);
      const title = anime.title.english || anime.title.romaji;
      const year = anime.seasonYear ? String(anime.seasonYear) : '';
      const result = await fetchOmegatechIds(title, year);
      setIsFetchingIds(false);
      // ✅ CRITICAL FALLBACK: If Omegatech fails, use the local AniList ID
      if (!result) {
        console.warn('Omegatech IDs not found, falling back to AniList ID:', anime.id);
        return { subjectId: String(anime.id), detailPath: '' };
      }
      return result;
    }
    return null;
  }, [subjectIdState, detailPathState, omSubjectId, omDetailPath, anime, fetchOmegatechIds]);

  const toggleWatchlist = useCallback(async () => {
    if (!anime) return;
    const itemId = `anime-${anime.id}`;
    const title = anime.title.english || anime.title.romaji;
    try {
      if (inWatchlist) {
        await removeItem(itemId);
        setInWatchlist(false);
      } else {
        await addItem({
          id: itemId, mediaId: anime.id, mediaType: 'anime',
          title, posterUrl: anime.coverImage.large,
          rating: anime.averageScore || 0,
          genres: anime.genres,
        });
        setInWatchlist(true);
      }
    } catch { showAlert('Watchlist Error', 'Unable to update your watchlist right now.'); }
  }, [anime, inWatchlist, addItem, removeItem, showAlert]);

  const handleWatch = useCallback(async (ep: number) => {
    if (isFetchingIds) {
      showAlert('Loading', 'Please wait while we load stream sources...');
      return;
    }
    if (!anime) return;
    const ids = await ensureIds();
    if (!ids) {
      showAlert('Playback Error', 'Could not find stream source for this title.');
      return;
    }
    const title = anime.title.english || anime.title.romaji;
    try {
      await addHistoryItem({
        id: `anime-${anime.id}`, mediaId: anime.id, mediaType: 'anime',
        title, posterUrl: anime.coverImage.large,
        rating: anime.averageScore || 0,
        episode: ep, progress: 0,
      });
    } catch {}

    try {
      const queryParams = new URLSearchParams();
      queryParams.set('type', 'anime');
      queryParams.set('ep', String(ep));
      queryParams.set('title', encodeURIComponent(title));
      if (anime.idMal) queryParams.set('malId', String(anime.idMal));
      queryParams.set('subjectId', ids.subjectId);
      queryParams.set('detailPath', ids.detailPath);
      router.push(`/player/${anime.id}?${queryParams.toString()}`);
    } catch {
      showAlert('Playback Error', 'Unable to open the player.');
    }
  }, [anime, addHistoryItem, router, showAlert, ensureIds, isFetchingIds]);

  // Quality picker state for episode downloads (mirrors movie/TV)
  const [showEpQualityModal, setShowEpQualityModal] = useState(false);
  const [epQualities, setEpQualities] = useState<{ label: string; value: string; url: string; size?: string }[]>([]);
  const [loadingEpQualities, setLoadingEpQualities] = useState(false);
  const [downloadTargetEp, setDownloadTargetEp] = useState<number | null>(null);

  const handleDownload = useCallback(async (ep: number) => {
    if (!anime) return;
    const ids = await ensureIds();
    if (!ids?.subjectId) {
      showAlert('Download Unavailable', 'No download source available for this title.');
      return;
    }
    setDownloadTargetEp(ep);
    setEpQualities([]);
    setLoadingEpQualities(true);
    setShowEpQualityModal(true);
    try {
      const url = apiUrl('/api/download', {
        subject_id: ids.subjectId,
        detail_path: ids.detailPath || '',
        season: 1,
        episode: ep,
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
  }, [anime, ensureIds, showAlert]);

  const performEpisodeDownload = useCallback(async (q: { label: string; url: string }) => {
    setShowEpQualityModal(false);
    const ep = downloadTargetEp;
    if (!anime || ep == null) return;
    const title = anime.title.english || anime.title.romaji;
    try {
      await startDownload({
        id: `anime-dl-${anime.id}-ep${ep}-${q.label}`,
        mediaId: anime.id, mediaType: 'anime',
        title, posterUrl: anime.coverImage.large,
        rating: anime.averageScore || 0,
        episode: ep, episodeName: `Episode ${ep}`,
        size: 'Direct link',
        status: 'completed', progress: 100,
        sourceUrl: q.url,
      });
      await triggerSecureDownload({ url: q.url, fileName: `${title} Episode ${ep} ${q.label}.mp4`, preResolved: true });
      showAlert('Download Started', `Started ${q.label} download for episode ${ep}.`);
    } catch {
      showAlert('Download Error', 'Unable to start the download right now.');
    }
  }, [anime, downloadTargetEp, startDownload, showAlert]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={Colors.animeColor} />
      </View>
    );
  }

  if (error || !anime) {
    return (
      <View style={styles.emptyWrap}>
        <MaterialIcons name="error-outline" size={42} color={Colors.animeColor} />
        <Text style={styles.emptyTitle}>Anime details unavailable</Text>
        <Text style={styles.emptyText}>{error || 'We could not find this anime.'}</Text>
        <View style={styles.emptyActions}>
          <Pressable style={styles.emptyButton} onPress={loadAnime}>
            <Text style={styles.emptyButtonText}>Try Again</Text>
          </Pressable>
          <Pressable style={[styles.emptyButton, styles.emptySecondaryButton]} onPress={() => router.back()}>
            <Text style={styles.emptyButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const title = anime.title.english || anime.title.romaji;
  const coverImage = anime.coverImage.extraLarge || anime.coverImage.large;
  const totalEps = anime.episodes || 12;
  const episodes = Array.from({ length: Math.min(totalEps, 50) }, (_, i) => i + 1);
  const characters = anime.characters?.nodes ?? [];
  const recommendations = (anime.recommendations?.nodes ?? [])
    .map(node => node.mediaRecommendation)
    .filter((item): item is AniListMedia => Boolean(item));

  return (
    <ScrollView style={styles.root} showsVerticalScrollIndicator={false}>
      {/* Banner */}
      <View style={styles.bannerWrap}>
        {anime.bannerImage ? (
          <Image source={{ uri: anime.bannerImage }} style={styles.banner} contentFit="cover" />
        ) : (
          <Image source={{ uri: coverImage }} style={styles.banner} contentFit="cover" />
        )}
        <LinearGradient colors={['transparent', Colors.background]} style={styles.bannerGrad} />
      </View>

      <View style={styles.content}>
        <View style={styles.posterRow}>
          <Image source={{ uri: coverImage }} style={styles.poster} contentFit="cover" />
          <View style={styles.mainInfo}>
            <Text style={styles.title}>{title}</Text>
            {anime.title.romaji !== title ? (
              <Text style={styles.romaji}>{anime.title.romaji}</Text>
            ) : null}
            <View style={styles.metaRow}>
              {anime.seasonYear ? <Text style={styles.metaItem}>{anime.seasonYear}</Text> : null}
              {anime.seasonYear ? <View style={styles.dot} /> : null}
              {anime.episodes ? <Text style={styles.metaItem}>{anime.episodes} eps</Text> : null}
              {anime.averageScore ? (
                <>
                  <View style={styles.dot} />
                  <MaterialIcons name="star" size={13} color={Colors.accent} />
                  <Text style={[styles.metaItem, { color: Colors.accent }]}>
                    {(anime.averageScore / 10).toFixed(1)}
                  </Text>
                </>
              ) : null}
            </View>
            <View style={styles.statusRow}>
              <View style={[styles.statusBadge,
                { backgroundColor: anime.status === 'RELEASING' ? 'rgba(46,204,113,0.15)' : 'rgba(255,215,0,0.1)' }
              ]}>
                <View style={[styles.statusDot,
                  { backgroundColor: anime.status === 'RELEASING' ? Colors.success : Colors.accent }
                ]} />
                <Text style={[styles.statusText,
                  { color: anime.status === 'RELEASING' ? Colors.success : Colors.accent }
                ]}>
                  {anime.status === 'RELEASING' ? 'Airing' : anime.status}
                </Text>
              </View>
              {anime.format ? (
                <View style={styles.formatTag}>
                  <Text style={styles.formatText}>{anime.format.replace(/_/g, ' ')}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.genres}>
              {anime.genres.slice(0, 3).map(g => (
                <View key={g} style={styles.genreTag}>
                  <Text style={styles.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.watchBtn, pressed && { opacity: 0.85 }]}
            onPress={() => handleWatch(1)}
            disabled={isFetchingIds}
          >
            <MaterialIcons name="play-arrow" size={22} color={Colors.textInverse} />
            <Text style={styles.watchBtnText}>{isFetchingIds ? 'Loading...' : 'Watch Ep 1'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, inWatchlist && styles.iconBtnActive, pressed && { opacity: 0.7 }]}
            onPress={toggleWatchlist}
          >
            <MaterialIcons
              name={inWatchlist ? 'bookmark' : 'bookmark-border'}
              size={22}
              color={inWatchlist ? Colors.animeColor : Colors.textPrimary}
            />
          </Pressable>
        </View>

        {/* Description */}
        {anime.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Synopsis</Text>
            <Text style={styles.overview}>
              {anime.description.replace(/<[^>]+>/g, '')}
            </Text>
          </View>
        ) : null}

        {/* Studio */}
        {anime.studios?.nodes?.length > 0 ? (
          <View style={styles.studioRow}>
            <MaterialIcons name="business" size={14} color={Colors.textMuted} />
            <Text style={styles.studioText}>
              {anime.studios.nodes.filter(s => s.isAnimationStudio).map(s => s.name).join(', ')}
            </Text>
          </View>
        ) : null}

        {/* Episodes */}
        {episodes.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Episodes ({totalEps})</Text>
            <View style={styles.episodeGrid}>
              {episodes.map(ep => (
                <View key={ep} style={styles.epRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.epBtn,
                      selectedEp === ep && styles.epBtnActive,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={() => { setSelectedEp(ep); handleWatch(ep); }}
                    disabled={isFetchingIds}
                  >
                    <MaterialIcons
                      name="play-circle-outline"
                      size={16}
                      color={selectedEp === ep ? Colors.textInverse : Colors.textMuted}
                    />
                    <Text style={[styles.epText, selectedEp === ep && styles.epTextActive]}>
                      {isFetchingIds ? '...' : `Ep ${ep}`}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.epDownloadBtn}
                    onPress={() => handleDownload(ep)}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <MaterialIcons name="download" size={16} color={Colors.downloadColor} />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Characters */}
        {characters.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Characters</Text>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={characters}
              keyExtractor={c => String(c.id)}
              contentContainerStyle={{ gap: 12 }}
              renderItem={({ item }) => (
                <View style={styles.castItem}>
                  <View style={styles.castAvatar}>
                    <Image source={{ uri: item.image.large }} style={styles.castImg} contentFit="cover" />
                  </View>
                  <Text style={styles.castName} numberOfLines={2}>{item.name.full}</Text>
                </View>
              )}
            />
          </View>
        ) : null}

        {/* Recommendations */}
        {recommendations.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>You May Also Like</Text>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={recommendations}
              keyExtractor={item => String(item.id)}
              renderItem={({ item }) => (
                <AnimeCard
                  item={item}
                  onPress={() => router.push(`/anime/${item.id}`)}
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
                      <MaterialIcons name="movie" size={18} color={Colors.animeColor} />
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
  root: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, paddingHorizontal: Spacing.lg },
  emptyTitle: { color: Colors.textPrimary, fontSize: FontSizes.lg, fontWeight: FontWeights.bold, marginTop: Spacing.md, textAlign: 'center' },
  emptyText: { color: Colors.textSecondary, fontSize: FontSizes.sm, textAlign: 'center', marginTop: Spacing.xs, lineHeight: 20 },
  emptyActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: Spacing.lg },
  emptyButton: { backgroundColor: Colors.animeColor, borderRadius: Radii.md, paddingHorizontal: Spacing.lg, paddingVertical: 12 },
  emptySecondaryButton: { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  emptyButtonText: { color: Colors.textInverse, fontSize: FontSizes.md, fontWeight: FontWeights.bold },
  bannerWrap: { height: 240 },
  banner: { width: '100%', height: '100%' },
  bannerGrad: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 160 },
  content: { paddingHorizontal: Spacing.md },
  posterRow: { flexDirection: 'row', gap: Spacing.md, marginTop: -60, marginBottom: Spacing.md },
  poster: { width: 110, height: 165, borderRadius: Radii.md, ...Shadows.card },
  mainInfo: { flex: 1, paddingTop: 40 },
  title: { color: Colors.textPrimary, fontSize: FontSizes.xl, fontWeight: FontWeights.black, lineHeight: 26 },
  romaji: { color: Colors.textMuted, fontSize: FontSizes.sm, fontStyle: 'italic', marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, flexWrap: 'wrap' },
  metaItem: { color: Colors.textSecondary, fontSize: FontSizes.sm },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.textMuted },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radii.full },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: FontSizes.xs, fontWeight: FontWeights.semibold },
  formatTag: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: Colors.surfaceElevated, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border },
  formatText: { color: Colors.textMuted, fontSize: FontSizes.xs },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  genreTag: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(255,215,0,0.1)', borderRadius: Radii.full, borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)' },
  genreText: { color: Colors.animeColor, fontSize: FontSizes.xs },
  actions: { flexDirection: 'row', gap: 10, marginBottom: Spacing.lg },
  watchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.animeColor, borderRadius: Radii.md, paddingVertical: 12 },
  watchBtnText: { color: Colors.textInverse, fontSize: FontSizes.md, fontWeight: FontWeights.bold },
  iconBtn: { width: 48, height: 48, borderRadius: Radii.md, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  iconBtnActive: { borderColor: Colors.animeColor },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSizes.lg, fontWeight: FontWeights.bold, marginBottom: Spacing.sm },
  overview: { color: Colors.textSecondary, fontSize: FontSizes.base, lineHeight: 24 },
  studioRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.md },
  studioText: { color: Colors.textMuted, fontSize: FontSizes.sm },
  episodeGrid: { gap: 8 },
  epRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  epBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surfaceCard, borderRadius: Radii.sm, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border },
  epBtnActive: { backgroundColor: Colors.animeColor, borderColor: Colors.animeColor },
  epText: { color: Colors.textSecondary, fontSize: FontSizes.sm, fontWeight: FontWeights.medium },
  epTextActive: { color: Colors.textInverse },
  epDownloadBtn: { width: 36, height: 36, borderRadius: Radii.sm, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  castItem: { width: 72, alignItems: 'center' },
  castAvatar: { width: 60, height: 60, borderRadius: 30, overflow: 'hidden', marginBottom: 6 },
  castImg: { width: 60, height: 60 },
  castName: { color: Colors.textPrimary, fontSize: FontSizes.xs, textAlign: 'center', fontWeight: FontWeights.medium },
});

import { useState, useCallback, useRef } from 'react';
import { searchMovies, searchTV, TMDBItem, discoverMovies, discoverTV } from '@/services/tmdbService';
import { searchAnime, browseAnime, AniListMedia } from '@/services/anilistService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SEARCH_HISTORY_KEY = 'violetflix_search_history';

export type SearchFilter = 'all' | 'movies' | 'tv' | 'anime';
export type SortOption = 'popularity' | 'rating' | 'newest' | 'oldest';

export interface AdvancedFilters {
  yearFrom: number | null;
  yearTo: number | null;
  minRating: number;
  genres: number[];
  animeGenres: string[];
  sortBy: SortOption;
}

export const DEFAULT_FILTERS: AdvancedFilters = {
  yearFrom: null,
  yearTo: null,
  minRating: 0,
  genres: [],
  animeGenres: [],
  sortBy: 'popularity',
};

export interface SearchResult {
  movies: TMDBItem[];
  tv: TMDBItem[];
  anime: AniListMedia[];
}

// ─── Helper: Convert Omegatech item to TMDB shape ────────────────────────────
function omegatechToTMDB(item: any): TMDBItem {
  return {
    id: Number(item.subjectId) || 0,
    // BUG FIX: detailPath (and a string copy of subjectId) were being dropped
    // here. Search finds content via Omegatech directly, which returns a real
    // detailPath (needed by the player to fetch the actual Omegatech stream) —
    // but without it surviving this conversion, every search result silently
    // fell back to worse embed providers instead of your real m3u8/mp4 stream.
    subjectId: item.subjectId || '',
    detailPath: item.detailPath || '',
    title: item.title || '',
    name: item.title || '',
    poster_path: item.cover?.url || null,
    backdrop_path: null,
    vote_average: parseFloat(item.imdbRatingValue) || 0,
    vote_count: parseInt(item.imdbRatingCount) || 0,
    release_date: item.releaseDate || '',
    first_air_date: item.releaseDate || '',
    overview: item.description || '',
    genre_ids: [],
    media_type: item.subjectType === 1 ? 'movie' : 'tv',
    popularity: 0,
  } as TMDBItem;
}

// ─── Helper: Convert Omegatech item to AniList shape ─────────────────────────
function omegatechToAniList(item: any): AniListMedia {
  return {
    id: Number(item.subjectId) || 0,
    // Same fix as omegatechToTMDB above — keep these so the anime detail page
    // can hand a real detailPath to the player instead of an empty string.
    subjectId: item.subjectId || '',
    detailPath: item.detailPath || '',
    idMal: null,
    title: {
      romaji: item.title || '',
      english: item.title || '',
    },
    coverImage: {
      large: item.cover?.url || '',
      extraLarge: item.cover?.url || '',
      color: null,
    },
    bannerImage: null,
    episodes: null,
    averageScore: parseFloat(item.imdbRatingValue) * 10 || 0,
    popularity: 0,
    genres: (item.genre || '').split(',').map((g: string) => g.trim()),
    description: item.description || null,
    startDate: { year: parseInt(item.releaseDate?.slice(0, 4)) || null },
    endDate: { year: null },
    status: '',
    season: null,
    seasonYear: null,
    format: 'TV',
    duration: null,
    studios: { nodes: [] },
    nextAiringEpisode: null,
  } as AniListMedia;
}

// ─── Main hook ─────────────────────────────────────────────────────────────────
export function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult>({ movies: [], tv: [], anime: [] });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(DEFAULT_FILTERS);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeFilterCount = (
    (advancedFilters.yearFrom ? 1 : 0) +
    (advancedFilters.yearTo ? 1 : 0) +
    (advancedFilters.minRating > 0 ? 1 : 0) +
    (advancedFilters.genres.length > 0 ? 1 : 0) +
    (advancedFilters.animeGenres.length > 0 ? 1 : 0) +
    (advancedFilters.sortBy !== 'popularity' ? 1 : 0)
  );

  const loadHistory = useCallback(async () => {
    const raw = await AsyncStorage.getItem(SEARCH_HISTORY_KEY);
    setSearchHistory(raw ? JSON.parse(raw) : []);
  }, []);

  const saveToHistory = useCallback(async (term: string) => {
    if (!term.trim()) return;
    const raw = await AsyncStorage.getItem(SEARCH_HISTORY_KEY);
    const history: string[] = raw ? JSON.parse(raw) : [];
    const updated = [term, ...history.filter(h => h !== term)].slice(0, 20);
    await AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
    setSearchHistory(updated);
  }, []);

  const clearHistory = useCallback(async () => {
    await AsyncStorage.removeItem(SEARCH_HISTORY_KEY);
    setSearchHistory([]);
  }, []);

  // ─── Core search function ──────────────────────────────────────────────────
  const search = useCallback(async (term: string, filters: AdvancedFilters = advancedFilters) => {
    if (!term.trim()) {
      setResults({ movies: [], tv: [], anime: [] });
      return;
    }
    setLoading(true);

    try {
      // 1️⃣ Try Omegatech search (primary)
      const omegatechRes = await fetch(`/api/omegatech/search?keyword=${encodeURIComponent(term)}`);
      const omegatechData = await omegatechRes.json();

      if (omegatechData.success && omegatechData.data?.items?.length > 0) {
        const items = omegatechData.data.items;
        const movies: TMDBItem[] = [];
        const tv: TMDBItem[] = [];
        const anime: AniListMedia[] = [];

        items.forEach((item: any) => {
          const genreStr = item.genre || '';
          const genres = genreStr.split(',').map((g: string) => g.trim());
          const isAnime = genres.includes('Anime');
          const subjectType = item.subjectType;

          if (isAnime) {
            anime.push(omegatechToAniList(item));
          } else if (subjectType === 1) {
            movies.push(omegatechToTMDB(item));
          } else if (subjectType === 2) {
            tv.push(omegatechToTMDB(item));
          } else {
            // fallback: treat as TV
            tv.push(omegatechToTMDB(item));
          }
        });

        setResults({ movies, tv, anime });
        await saveToHistory(term);
        setLoading(false);
        return;
      }
    } catch (e) {
      console.warn('Omegatech search failed, falling back to TMDB/AniList', e);
    }

    // 2️⃣ Fallback to TMDB / AniList (if Omegatech fails or returns no results)
    try {
      const tmdbParams: Record<string, string> = {};
      if (filters.yearFrom) tmdbParams['primary_release_date.gte'] = `${filters.yearFrom}-01-01`;
      if (filters.yearTo) tmdbParams['primary_release_date.lte'] = `${filters.yearTo}-12-31`;
      if (filters.minRating > 0) tmdbParams['vote_average.gte'] = String(filters.minRating);
      if (filters.genres.length > 0) tmdbParams['with_genres'] = filters.genres.join(',');
      tmdbParams['sort_by'] = buildTMDBSortParam(filters.sortBy);

      const aniFilters = {
        genres: filters.animeGenres,
        minScore: filters.minRating > 0 ? filters.minRating * 10 : undefined,
        year: filters.yearFrom || undefined,
        sort: buildAniListSortParam(filters.sortBy),
      };

      const [movies, tv, animeRes] = await Promise.all([
        searchMovies(term, tmdbParams).then(r => r.results.slice(0, 10)),
        searchTV(term, {}).then(r => r.results.slice(0, 10)),
        searchAnime(term, 1, aniFilters).then(r => r.media.slice(0, 10)),
      ]);
      setResults({ movies, tv, anime: animeRes });
      await saveToHistory(term);
    } catch (e) {
      console.warn('Fallback search also failed', e);
      setResults({ movies: [], tv: [], anime: [] });
    } finally {
      setLoading(false);
    }
  }, [advancedFilters, saveToHistory]);

  // ─── Helper functions for fallback sorting ─────────────────────────────────
  function buildTMDBSortParam(sort: SortOption): string {
    switch (sort) {
      case 'rating': return 'vote_average.desc';
      case 'newest': return 'release_date.desc';
      case 'oldest': return 'release_date.asc';
      default: return 'popularity.desc';
    }
  }

  function buildAniListSortParam(sort: SortOption): string {
    switch (sort) {
      case 'rating': return 'SCORE_DESC';
      case 'newest': return 'START_DATE_DESC';
      case 'oldest': return 'START_DATE';
      default: return 'POPULARITY_DESC';
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(text), 500);
  }, [search]);

  const applyFilters = useCallback((filters: AdvancedFilters) => {
    setAdvancedFilters(filters);
    if (query.trim()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => search(query, filters), 300);
    }
  }, [query, search]);

  const totalResults = results.movies.length + results.tv.length + results.anime.length;

  return {
    query,
    setQuery: handleQueryChange,
    results,
    loading,
    filter,
    setFilter,
    totalResults,
    searchHistory,
    loadHistory,
    clearHistory,
    advancedFilters,
    applyFilters,
    activeFilterCount,
  };
}

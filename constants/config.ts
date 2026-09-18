// constants/config.ts
export const TMDB_CONFIG = {
  BASE_URL: 'https://api.themoviedb.org/3',
  IMAGE_BASE: 'https://image.tmdb.org/t/p',
  POSTER_SIZES: {
    small: 'w185',
    medium: 'w342',
    large: 'w500',
    original: 'original',
  },
  BACKDROP_SIZES: {
    small: 'w300',
    medium: 'w780',
    large: 'w1280',
    original: 'original',
  },
  API_KEY: process.env.EXPO_PUBLIC_TMDB_API_KEY || '4e44d9029b1270a757cddc766a1bcb63',
};

export const ANILIST_CONFIG = {
  BASE_URL: 'https://graphql.anilist.co',
};

export const TMDB_IMAGE = (path: string, size: keyof typeof TMDB_CONFIG.POSTER_SIZES = 'medium') => {
  if (!path) return null;
  const sizeKey = TMDB_CONFIG.POSTER_SIZES[size] || 'w500';
  return `${TMDB_CONFIG.IMAGE_BASE}/${sizeKey}${path}`;
};

export const TMDB_BACKDROP = (path: string, size: keyof typeof TMDB_CONFIG.BACKDROP_SIZES = 'large') => {
  if (!path) return null;
  const sizeKey = TMDB_CONFIG.BACKDROP_SIZES[size] || 'w1280';
  return `${TMDB_CONFIG.IMAGE_BASE}/${sizeKey}${path}`;
};

export const PLACEHOLDER_POSTER = 
  'https://via.placeholder.com/300x450/111111/666666?text=No+Poster';

export const PLACEHOLDER_BACKDROP = 
  'https://via.placeholder.com/1280x720/111111/666666?text=No+Backdrop';

// ✅ DYNAMIC BASE URL — NO HARDCODED FALLBACK
export const BASE_URL = 
  process.env.EXPO_PUBLIC_APP_URL ||                     // 1. Explicit env var
  (typeof window !== 'undefined' ? window.location.origin : '');

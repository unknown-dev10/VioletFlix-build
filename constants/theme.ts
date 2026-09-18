// VioletFlix Design System - Updated Indigo-Blue Theme
export const Colors = {
  // Base
  background: '#050506',
  surface: '#0a0a0c',
  surfaceElevated: '#0f0f14',
  surfaceCard: '#111118',
  border: 'rgba(99, 102, 241, 0.18)',
  borderSubtle: 'rgba(99, 102, 241, 0.1)',

  // Brand — New Indigo-Blue Theme
  primary: '#6366f1',           // Main color
  primaryDark: '#4f46e5',
  primaryLight: '#818cf8',
  primaryGlow: 'rgba(99, 102, 241, 0.35)',
  accent: '#22d3ee',            // Cyan accent (kept for nice contrast)
  accentGlow: 'rgba(34, 211, 238, 0.15)',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#AAAAAA',
  textMuted: '#666666',
  textInverse: '#0a0a0a',

  // Semantic
  success: '#2ECC71',
  warning: '#F39C12',
  info: '#3498DB',
  error: '#ef4444',

  // Special
  overlay: 'rgba(0,0,0,0.7)',
  overlayLight: 'rgba(0,0,0,0.4)',
  overlayStrong: 'rgba(0,0,0,0.85)',
  frosted: 'rgba(26,26,26,0.9)',

  // Categories
  animeColor: '#FFD700',
  movieColor: '#6366f1',        // Updated to match primary
  seriesColor: '#22d3ee',
  downloadColor: '#2ECC71',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radii = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const FontSizes = {
  xs: 11,
  sm: 13,
  md: 15,
  base: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  xxxl: 30,
  hero: 36,
};

export const FontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  black: '900' as const,
};

export const Shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  glow: {
    shadowColor: '#6366f1',     // Updated to new primary
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
  },
  hero: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 16,
  },
};

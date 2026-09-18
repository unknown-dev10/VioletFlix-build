import React, { useState, useRef, useCallback, memo, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, Dimensions,
  FlatList, ViewToken, GestureResponderEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, Radii, FontSizes, FontWeights } from '@/constants/theme';
import { TMDBItem } from '@/services/tmdbService';
import { TMDB_IMAGE } from '@/constants/config';

const { width } = Dimensions.get('window');
const HERO_HEIGHT = 480;
const AUTO_SCROLL_INTERVAL = 4500;
const PAUSE_ON_PRESS_DURATION = 3000;

interface HeroBannerProps {
  items: TMDBItem[];
  onPress?: (item: TMDBItem) => void;
  onPlayPress?: (item: TMDBItem) => void;
}

function HeroBannerComponent({ items, onPress, onPlayPress }: HeroBannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatRef = useRef<FlatList>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef = useRef(false);

  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index ?? 0);
    }
  }, []);

  // Auto-scroll logic
  useEffect(() => {
    if (items.length <= 1) return;

    const startAutoScroll = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      timerRef.current = setInterval(() => {
        if (!isPausedRef.current) {
          setActiveIndex((prev) => {
            const next = (prev + 1) % items.length;
            flatRef.current?.scrollToIndex({
              index: next,
              animated: true,
            });
            return next;
          });
        }
      }, AUTO_SCROLL_INTERVAL);
    };

    startAutoScroll();

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [items.length]);

  // Pause auto-scroll temporarily on user interaction
  const pauseAutoScroll = useCallback(() => {
    if (isPausedRef.current) return;

    isPausedRef.current = true;

    // Resume after pause duration
    const resumeTimer = setTimeout(() => {
      isPausedRef.current = false;
    }, PAUSE_ON_PRESS_DURATION);

    return () => clearTimeout(resumeTimer);
  }, []);

  const handleItemPress = useCallback(
    (item: TMDBItem) => {
      pauseAutoScroll();
      onPress?.(item);
    },
    [onPress, pauseAutoScroll]
  );

  const handlePlayPress = useCallback(
    (item: TMDBItem, event: GestureResponderEvent) => {
      event.stopPropagation();
      pauseAutoScroll();
      onPlayPress?.(item);
    },
    [onPlayPress, pauseAutoScroll]
  );

  // Custom scrollToIndex with error handling
  const scrollToIndex = useCallback((index: number) => {
    try {
      flatRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });
      setActiveIndex(index);
      pauseAutoScroll();
    } catch (error) {
      console.warn('Scroll error:', error);
    }
  }, [pauseAutoScroll]);

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatRef}
        data={items}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{
          itemVisiblePercentThreshold: 50,
          minimumViewTime: 300,
        }}
        keyExtractor={(item) => String(item.id)}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        onScrollBeginDrag={() => pauseAutoScroll()}
        renderItem={({ item }) => {
          const backdropUri = item.backdrop_path
            ? TMDB_IMAGE(item.backdrop_path, 'w1280')
            : null;
          const title = item.title || item.name || '';
          const year = (item.release_date || item.first_air_date || '').slice(0, 4);

          return (
            <Pressable
              style={styles.slide}
              onPress={() => handleItemPress(item)}
            >
              {backdropUri ? (
                <Image
                  source={{ uri: backdropUri }}
                  style={styles.backdrop}
                  contentFit="cover"
                  transition={300}
                  // Slight blur on the backdrop itself gives real
                  // depth-of-field behind the floating glass panel,
                  // instead of a flat image sitting under a flat overlay.
                  blurRadius={3}
                  onError={() => console.warn('Failed to load backdrop:', item.id)}
                />
              ) : (
                <View style={[styles.backdrop, styles.backdropFallback]}>
                  <MaterialIcons name="movie" size={48} color={Colors.textMuted} />
                </View>
              )}
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(5,5,8,0.85)']}
                style={styles.gradient}
              />

              {/* Floating frosted glass panel — sits above the backdrop with
                  its own blur, margin on all sides (not flush to the bottom
                  edge), and a plain static border. */}
              <BlurView intensity={40} tint="dark" style={styles.glassPanel}>
                <View style={styles.glassPanelOverlay}>
                  <View style={styles.badges}>
                    <View style={styles.badge}>
                      <MaterialIcons name="star" size={12} color={Colors.accent} />
                      <Text style={styles.badgeText}>{item.vote_average.toFixed(1)}</Text>
                    </View>
                    {year ? (
                      <View style={styles.yearBadge}>
                        <Text style={styles.yearText}>{year}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.title} numberOfLines={2}>
                    {title}
                  </Text>
                  <Text style={styles.overview} numberOfLines={2}>
                    {item.overview || 'No description available'}
                  </Text>
                  <View style={styles.actions}>
                    <Pressable
                      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                      onPress={(event) => handlePlayPress(item, event)}
                    >
                      <LinearGradient
                        colors={[Colors.accent, Colors.primary]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.playBtn}
                      >
                        <MaterialIcons name="play-arrow" size={20} color="#fff" />
                        <Text style={styles.playText}>Watch Now</Text>
                      </LinearGradient>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.infoBtn, pressed && { opacity: 0.7 }]}
                      onPress={(event) => {
                        event.stopPropagation();
                        handleItemPress(item);
                      }}
                    >
                      <MaterialIcons name="info-outline" size={20} color={Colors.textPrimary} />
                      <Text style={styles.infoText}>Details</Text>
                    </Pressable>
                  </View>
                </View>
              </BlurView>
            </Pressable>
          );
        }}
      />
      {/* Dot indicators */}
      <View style={styles.dots}>
        {items.map((_, i) => (
          <Pressable
            key={i}
            onPress={() => scrollToIndex(i)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export const HeroBanner = memo(HeroBannerComponent);

const styles = StyleSheet.create({
  container: { height: HERO_HEIGHT },
  slide: { width, height: HERO_HEIGHT },
  backdrop: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  backdropFallback: {
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_HEIGHT * 0.75,
  },
  glassPanel: {
    position: 'absolute',
    bottom: 56,
    left: Spacing.md,
    right: Spacing.md,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  glassPanelOverlay: {
    // BlurView gives the blur; this thin tint on top matches the
    // rgba(255,255,255,0.06) frosted look from the approved design,
    // which BlurView's `tint` prop alone doesn't fully reproduce.
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 20,
  },
  badges: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: Colors.accentGlow,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radii.full,
  },
  badgeText: {
    color: Colors.accent,
    fontSize: FontSizes.xs,
    fontWeight: FontWeights.bold,
  },
  yearBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: Colors.primaryGlow,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radii.full,
  },
  yearText: {
    color: Colors.primaryLight,
    fontSize: FontSizes.xs,
    fontWeight: FontWeights.semibold,
  },
  title: {
    color: Colors.textPrimary,
    fontFamily: 'Fraunces_600SemiBold_Italic',
    fontSize: 32,
    lineHeight: 36,
    marginBottom: 10,
  },
  overview: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    lineHeight: 20,
    marginBottom: 18,
  },
  actions: { flexDirection: 'row', gap: 12 },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Radii.md,
  },
  playText: {
    color: '#fff',
    fontSize: FontSizes.md,
    fontWeight: FontWeights.bold,
  },
  infoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radii.md,
  },
  infoText: {
    color: Colors.textPrimary,
    fontSize: FontSizes.md,
    fontWeight: FontWeights.semibold,
  },
  dots: {
    position: 'absolute',
    bottom: 28,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.textMuted,
  },
  dotActive: {
    width: 18,
    backgroundColor: Colors.primary,
  },
});

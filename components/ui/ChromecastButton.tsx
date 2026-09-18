import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Pressable, Text, StyleSheet, Platform } from 'react-native';
import { Colors, FontSizes, FontWeights, Radii } from '@/constants/theme';

// Type declarations for Chrome Cast API
declare global {
  interface Window {
    __onGCastApiAvailable?: (available: boolean) => void;
    cast?: {
      framework: {
        CastContext: {
          getInstance: () => CastContextInstance;
        };
        CastContextEventType: {
          SESSION_STATE_CHANGED: string;
        };
      };
      chrome?: {
        cast: {
          media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: string;
            MediaInfo: new (url: string, mimeType: string) => any;
            MovieMediaMetadata: new () => any;
            Image: new (url: string) => any;
            LoadRequest: new (mediaInfo: any) => any;
          };
          AutoJoinPolicy: {
            ORIGIN_SCOPED: string;
          };
        };
      };
    };
    chrome?: any;
  }
}

interface CastContextInstance {
  setOptions: (options: any) => void;
  addEventListener: (event: string, callback: () => void) => void;
  requestSession: () => Promise<void>;
  getCurrentSession: () => any | null;
  endCurrentSession: (stopCasting: boolean) => void;
}

interface CastState {
  available: boolean;
  connected: boolean;
  deviceName: string;
  casting: boolean;
}

function useCastToTV() {
  const [castState, setCastState] = useState<CastState>({
    available: false,
    connected: false,
    deviceName: '',
    casting: false,
  });
  const sessionRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    // Store the cleanup function
    let scriptElement: HTMLScriptElement | null = null;

    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      if (!isAvailable) return;
      try {
        const ctx = window.cast?.framework?.CastContext?.getInstance();
        if (!ctx) return;

        ctx.setOptions({
          receiverApplicationId: window.chrome?.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: window.chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED,
        });

        ctx.addEventListener(
          window.cast?.framework?.CastContextEventType?.SESSION_STATE_CHANGED,
          () => {
            const s = ctx.getCurrentSession();
            if (s) {
              setCastState({
                available: true,
                connected: true,
                deviceName: s.getCastDevice?.().friendlyName || 'TV',
                casting: false,
              });
              sessionRef.current = s;
            } else {
              setCastState((prev) => ({
                ...prev,
                connected: false,
                deviceName: '',
                casting: false,
              }));
              sessionRef.current = null;
            }
          }
        );
        setCastState((prev) => ({ ...prev, available: true }));
      } catch (error) {
        console.warn('Chromecast initialization error:', error);
      }
    };

    // Load Cast SDK
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.async = true;
    document.head.appendChild(script);
    scriptElement = script;

    return () => {
      try {
        if (scriptElement && document.head.contains(scriptElement)) {
          document.head.removeChild(scriptElement);
        }
        // Clean up global callback
        if (window.__onGCastApiAvailable) {
          delete window.__onGCastApiAvailable;
        }
      } catch (error) {
        console.warn('Chromecast cleanup error:', error);
      }
    };
  }, []);

  const requestCast = useCallback(
    async (videoUrl: string, title: string, posterUrl?: string, mimeType = 'video/mp4') => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        console.warn('Chromecast is only available on web');
        return;
      }

      try {
        const ctx = window.cast?.framework?.CastContext?.getInstance();
        if (!ctx) {
          console.warn('Cast context not available');
          return;
        }

        await ctx.requestSession();
        const session = ctx.getCurrentSession();
        if (!session) return;

        const mediaInfo = new window.chrome?.cast?.media?.MediaInfo(videoUrl, mimeType);
        if (!mediaInfo) return;

        mediaInfo.metadata = new window.chrome?.cast?.media?.MovieMediaMetadata();
        mediaInfo.metadata.title = title;
        if (posterUrl) {
          mediaInfo.metadata.images = [new window.chrome?.cast?.media?.Image(posterUrl)];
        }

        const req = new window.chrome?.cast?.media?.LoadRequest(mediaInfo);
        await session.loadMedia(req);
        setCastState((prev) => ({ ...prev, casting: true }));
      } catch (err: any) {
        if (err?.code !== 'CANCEL') {
          console.warn('Cast error:', err);
        }
      }
    },
    []
  );

  const stopCast = useCallback(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      const ctx = window.cast?.framework?.CastContext?.getInstance();
      ctx?.endCurrentSession(true);
      setCastState((prev) => ({ ...prev, casting: false }));
    } catch (error) {
      console.warn('Stop cast error:', error);
    }
  }, []);

  return { castState, requestCast, stopCast };
}

interface Props {
  videoUrl?: string;
  title: string;
  posterUrl?: string;
  mimeType?: string;
}

export function ChromecastButton({ videoUrl, title, posterUrl, mimeType }: Props) {
  const { castState, requestCast, stopCast } = useCastToTV();

  if (castState.casting) {
    return (
      <Pressable style={[styles.btn, styles.casting]} onPress={stopCast}>
        <Text style={styles.castIcon}>📺</Text>
        <Text style={[styles.btnText, { color: '#60a5fa' }]}>
          {castState.deviceName || 'Casting…'}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[styles.btn, castState.connected && styles.connected]}
      onPress={() => {
        if (videoUrl) {
          requestCast(videoUrl, title, posterUrl, mimeType);
        } else {
          console.warn('No video URL provided for casting');
        }
      }}
    >
      <Text style={styles.castIcon}>📺</Text>
      <Text style={styles.btnText}>Cast to TV</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  connected: {
    borderColor: 'rgba(96,165,250,0.4)',
    backgroundColor: 'rgba(96,165,250,0.1)',
  },
  casting: {
    borderColor: 'rgba(96,165,250,0.5)',
    backgroundColor: 'rgba(96,165,250,0.15)',
  },
  castIcon: { fontSize: 14 },
  btnText: { color: '#fff', fontSize: FontSizes.xs, fontWeight: FontWeights.bold },
});

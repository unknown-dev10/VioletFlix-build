import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Props = {
  uri: string;
  style?: any;
  onError?: (message: string) => void;
};

// WEB-ONLY implementation (picked automatically by the bundler for any file
// named `HlsVideoPlayer` because of the `.web.tsx` extension).
//
// Why this file exists: expo-av's <Video> compiles to a plain HTML <video>
// tag on web. Chrome/Firefox/Edge cannot play .m3u8 (HLS) natively in a
// <video> tag — only Safari can. Without this, every live match stream fails
// with exactly the error you saw ("failed to play, it may be offline") even
// though the URL itself is perfectly live — the browser just doesn't know how
// to decode HLS on its own.
//
// hls.js decodes the HLS segments in JS and feeds them into the <video> tag
// via the MediaSource API, which every modern browser DOES support.
export default function HlsVideoPlayer({ uri, style, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoadError(null);
    const video = videoRef.current;
    if (!video || !uri) return;

    let hls: any;
    let cancelled = false;
    let hasStarted = false;
    let networkRetries = 0;
    let mediaRetries = 0;
    const MAX_RETRIES = 3;

    // BUG FIX: `fail()` used to silently do nothing once playback had
    // started (`if (cancelled || hasStarted) return`). That meant a genuine
    // mid-stream error — a brief network blip on a live stream, very
    // plausible on a slow connection — just silently froze the player with
    // no error shown and no way to recover, instead of either retrying or
    // telling the user what happened.
    const fail = (msg: string) => {
      if (cancelled) return;
      setLoadError(msg);
      onError?.(msg);
    };
    const markStarted = () => { hasStarted = true; };
    video.addEventListener('playing', markStarted);
    video.addEventListener('loadeddata', markStarted);

    // hls.js can silently stall (network hang, dead CDN, etc.) without ever
    // firing a fatal `ERROR` event — the video just never starts. This only
    // applies before playback has actually begun. Bumped from 15s to 25s to
    // better tolerate a genuinely slow connection loading the first segments.
    const stallTimer = setTimeout(() => {
      if (!hasStarted) fail('Stream took too long to load. It may be offline.');
    }, 25000);

    // Safari has native HLS support — no library needed there.
    const canPlayNativeHls = video.canPlayType('application/vnd.apple.mpegurl');

    if (canPlayNativeHls) {
      video.src = uri;
      video.play().catch(() => {});
    } else {
      // Every other browser needs hls.js.
      import('hls.js')
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            fail('This browser cannot play this stream format.');
            return;
          }
          // Live HLS isn't a one-shot download like a movie file — it requires
          // continuously re-fetching the manifest plus new segments every few
          // seconds for as long as you watch. Default hls.js retry/timeout
          // settings aren't tuned for a flaky connection, so a brief hiccup
          // that a movie's native <video> playback would just buffer through
          // was instead surfacing as an immediate fatal error here. Configuring
          // more patient retry behavior up front, rather than only reacting
          // after a fatal error fires.
          hls = new Hls({
            manifestLoadingMaxRetry: 6,
            manifestLoadingRetryDelay: 1000,
            manifestLoadingMaxRetryTimeout: 10000,
            levelLoadingMaxRetry: 6,
            levelLoadingRetryDelay: 1000,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 1000,
            fragLoadingMaxRetryTimeout: 10000,
          });
          hls.loadSource(uri);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
            if (!data?.fatal) return;
            // Standard hls.js recovery pattern: network and media errors are
            // often transient (a brief blip on a live stream, especially over
            // a weak connection) and worth retrying a few times before
            // actually giving up — this was missing before, so ANY fatal
            // error immediately killed playback even when hls.js could very
            // likely have recovered on its own with a retry.
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (networkRetries < MAX_RETRIES) {
                  networkRetries++;
                  hls.startLoad();
                } else {
                  fail('This stream failed to play. It may be offline.');
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                if (mediaRetries < MAX_RETRIES) {
                  mediaRetries++;
                  hls.recoverMediaError();
                } else {
                  fail('This stream failed to play. It may be offline.');
                }
                break;
              default:
                fail('This stream failed to play. It may be offline.');
                break;
            }
          });
          video.play().catch(() => {});
        })
        .catch(() => {
          fail('Could not load the video player for this stream.');
        });
    }

    return () => {
      cancelled = true;
      clearTimeout(stallTimer);
      video.removeEventListener('playing', markStarted);
      video.removeEventListener('loadeddata', markStarted);
      if (hls) hls.destroy();
    };
  }, [uri]);

  if (loadError) {
    return (
      <View style={[style, styles.center]}>
        <Text style={styles.errorText}>{loadError}</Text>
      </View>
    );
  }

  // eslint-disable-next-line jsx-a11y/media-has-caption
  return (
    <video
      ref={videoRef}
      controls
      autoPlay
      playsInline
      style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
    />
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  errorText: { color: '#aaa' },
});

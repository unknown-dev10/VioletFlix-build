import React, { useRef } from 'react';
import { Video, ResizeMode } from 'expo-av';

type Props = {
  uri: string;
  style?: any;
  onError?: (message: string) => void;
};

// NATIVE implementation (iOS/Android app builds). expo-av's <Video> handles
// HLS (.m3u8) natively fine on both platforms — this is only a problem on web,
// which is why HlsVideoPlayer.web.tsx exists as a separate implementation.
export default function HlsVideoPlayer({ uri, style, onError }: Props) {
  const videoRef = useRef<Video>(null);

  return (
    <Video
      ref={videoRef}
      source={{ uri }}
      style={style}
      useNativeControls
      resizeMode={ResizeMode.CONTAIN}
      shouldPlay
      isLooping={false}
      onError={() => onError?.('This stream failed to play. It may be offline.')}
    />
  );
}

import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions, Animated } from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialIcons } from '@expo/vector-icons';
import { useMiniPlayer } from '@/contexts/MiniPlayerContext';
import { Colors, Radii, FontSizes, FontWeights } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MINI_WIDTH = SCREEN_WIDTH * 0.4;
const MINI_HEIGHT = (MINI_WIDTH * 9) / 16;

export function MiniPlayer() {
  const { isVisible, url, title, currentTime, isPaused, closeMiniPlayer } = useMiniPlayer();
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideAnim, { toValue: isVisible ? 1 : 0, useNativeDriver: true }).start();
  }, [isVisible]);

  if (!isVisible || !url) return null;

  const restoreScript = `
    (function() {
      var v = document.querySelector('video');
      if (v) { v.currentTime = ${currentTime}; if (${isPaused}) v.pause(); else v.play(); }
    })(); true;
  `;

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [100, 0] }) }], opacity: slideAnim }]}>
      <View style={styles.card}>
        <WebView source={{ uri: url }} style={styles.webview} javaScriptEnabled domStorageEnabled injectedJavaScript={restoreScript} mediaPlaybackRequiresUserAction={false} mixedContentMode="always" />
        <View style={styles.overlay}>
          <Pressable onPress={closeMiniPlayer} style={styles.closeBtn}>
            <MaterialIcons name="close" size={16} color="#fff" />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{title || 'Playing...'}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', bottom: 20, right: 16, zIndex: 9999, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 12 },
  card: { width: MINI_WIDTH, height: MINI_HEIGHT, backgroundColor: Colors.surfaceElevated, borderRadius: Radii.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  webview: { width: MINI_WIDTH, height: MINI_HEIGHT, backgroundColor: '#000' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6, backgroundColor: 'rgba(0,0,0,0.6)' },
  closeBtn: { padding: 4 },
  title: { color: 'rgba(255,255,255,0.8)', fontSize: FontSizes.xs, fontWeight: FontWeights.medium, flex: 1, textAlign: 'right' },
});

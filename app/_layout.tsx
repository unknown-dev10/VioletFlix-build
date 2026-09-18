import { AlertProvider, AuthProvider } from '@/template';
import { WatchPartyProvider } from '@/contexts/WatchPartyContext';
import { WatchlistProvider } from '@/contexts/WatchlistContext';
import { MiniPlayerProvider } from '@/contexts/MiniPlayerContext';
import { MiniPlayer } from '@/components/ui/MiniPlayer';
import { Colors, FontSizes, FontWeights, Radii, Spacing } from '@/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, router, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AIChatbot } from '@/components/ui/AIChatbot';
import { PWAInstallBanner } from '@/components/ui/PWAInstallBanner';
import * as Notifications from 'expo-notifications';
import { registerForPushNotificationsAsync } from '@/services/pushNotifications';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Fraunces_600SemiBold_Italic } from '@expo-google-fonts/fraunces';

// Keep the splash screen up until the hero's serif title font is ready —
// otherwise it flashes in the system default font for a frame on first load.
SplashScreen.preventAutoHideAsync();

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.errorRoot}>
        <View style={styles.errorCard}>
          <MaterialIcons name="error-outline" size={48} color={Colors.primary} />
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorMessage} numberOfLines={4}>
            {error.message || 'This page hit an unexpected error instead of rendering.'}
          </Text>
          <View style={styles.errorActions}>
            <Pressable style={styles.errorPrimaryButton} onPress={retry}>
              <Text style={styles.errorPrimaryText}>Try again</Text>
            </Pressable>
            <Pressable style={styles.errorSecondaryButton} onPress={() => router.replace('/')}>
              <Text style={styles.errorSecondaryText}>Go home</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Fraunces_600SemiBold_Italic });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // ─── Push Notifications ──────────────────────────────────────────────
  useEffect(() => {
    registerForPushNotificationsAsync();
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    return () => subscription.remove();
  }, []);

  if (!fontsLoaded) return null; // splash screen stays up until this flips true

  return (
    <AlertProvider>
      <SafeAreaProvider>
        <AuthProvider>
          <WatchlistProvider>
            <WatchPartyProvider>
              <MiniPlayerProvider>
                <StatusBar style="light" />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="login" options={{ headerShown: false }} />
                  <Stack.Screen name="admin" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="movie/[id]"
                    options={{
                      headerShown: true,
                      headerTransparent: true,
                      headerTitle: '',
                      headerTintColor: Colors.textPrimary,
                      headerBackTitle: '',
                    }}
                  />
                  <Stack.Screen
                    name="tv/[id]"
                    options={{
                      headerShown: true,
                      headerTransparent: true,
                      headerTitle: '',
                      headerTintColor: Colors.textPrimary,
                      headerBackTitle: '',
                    }}
                  />
                  <Stack.Screen
                    name="anime/[id]"
                    options={{
                      headerShown: true,
                      headerTransparent: true,
                      headerTitle: '',
                      headerTintColor: Colors.textPrimary,
                      headerBackTitle: '',
                    }}
                  />
                  <Stack.Screen
                    name="player/[id]"
                    options={{
                      headerShown: false,
                      presentation: 'fullScreenModal',
                    }}
                  />
                </Stack>
                <AIChatbot />
                <PWAInstallBanner />
                <MiniPlayer />
              </MiniPlayerProvider>
            </WatchPartyProvider>
          </WatchlistProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </AlertProvider>
  );
}

const styles = StyleSheet.create({
  errorRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.background,
  },
  errorCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  errorTitle: {
    color: Colors.textPrimary,
    fontSize: FontSizes.xl,
    fontWeight: FontWeights.bold,
    textAlign: 'center',
  },
  errorMessage: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  errorPrimaryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    backgroundColor: Colors.primary,
  },
  errorPrimaryText: {
    color: Colors.textInverse,
    fontSize: FontSizes.sm,
    fontWeight: FontWeights.semibold,
  },
  errorSecondaryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  errorSecondaryText: {
    color: Colors.textPrimary,
    fontSize: FontSizes.sm,
    fontWeight: FontWeights.semibold,
  },
});

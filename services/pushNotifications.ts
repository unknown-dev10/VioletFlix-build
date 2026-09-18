// services/pushNotifications.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { getSupabaseClient } from '@/template';

// Handle notifications when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Registers the device for push notifications and saves the token to Supabase.
 * Call this once when the app starts (e.g., in _layout.tsx).
 */
export async function registerForPushNotificationsAsync() {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  // Request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('Failed to get push token — permission denied');
    return null;
  }

  // Get the Expo push token
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  console.log('Expo Push Token:', token);

  // Save token to Supabase for the logged-in user
  if (token) {
    try {
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('user_profiles').update({ push_token: token }).eq('id', user.id);
        console.log('Push token saved to Supabase for user:', user.id);
      } else {
        console.warn('No authenticated user — push token not saved.');
      }
    } catch (e) {
      console.warn('Failed to save push token to Supabase:', e);
    }
  }

  return token;
}

/**
 * Schedules a local notification for an upcoming anime episode.
 * This fires on the device regardless of network.
 */
export function scheduleAiringNotification(animeTitle: string, episode: number, airingAt: number) {
  const trigger = new Date(airingAt * 1000);
  
  Notifications.scheduleNotificationAsync({
    content: {
      title: `${animeTitle} - Episode ${episode}`,
      body: 'New episode is now airing!',
      data: { animeTitle, episode },
    },
    trigger: {
      date: trigger,
    },
  });
}

/**
 * Sends a remote push notification to a specific user via your backend.
 * Call this when you want to send a real push (e.g., new episode alert).
 */
export async function sendPushForAnime(userId: string, title: string, episode: number) {
  const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://your-railway-url.com';
  
  try {
    const response = await fetch(`${API_URL}/api/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        title: `${title} - Episode ${episode}`,
        body: 'New episode is now airing!',
      }),
    });

    const result = await response.json();
    console.log('Push sent:', result);
    return result;
  } catch (e) {
    console.error('Failed to send push:', e);
    return null;
  }
}

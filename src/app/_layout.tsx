import { Stack } from 'expo-router';
import { DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';
import Constants from 'expo-constants';
import type { Notification } from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import { activateStatusOutbox, addStatusOutboxAppStateListener, syncPendingStatusUpdates } from '../services/statusOutbox';


export const unstable_settings = {
  anchor: '(tabs)',
};

function useNotificationNavigation() {
  useEffect(() => {
    // Expo Go no longer supports remote push notifications on Android (SDK 53+).
    // The listener is only needed in development/standalone builds that can receive them.
    if (Platform.OS === 'web' || Constants.appOwnership === 'expo') return;

    let responseSubscription: { remove: () => void } | undefined;
    let cancelled = false;

    async function setupNotificationNavigation() {
      // Keep the runtime import behind the Expo Go check: loading this module
      // statically can throw on Android Expo Go before React effects run.
      const Notifications = await import('expo-notifications');
      if (cancelled) return;

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });

      const openFromNotification = (notification: Notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      if (typeof data?.url === 'string') {
        router.push(data.url as any);
      } else if (typeof data?.alertId === 'string') {
        router.push({ pathname: '/alert', params: { alertId: data.alertId } });
      }
      };

      const initialResponse = Notifications.getLastNotificationResponse();
      if (!cancelled && initialResponse?.notification) openFromNotification(initialResponse.notification);

      responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
        openFromNotification(response.notification);
      });
      if (cancelled) responseSubscription.remove();
    }

    setupNotificationNavigation().catch((error) => {
      console.error('Notification navigation setup failed:', error);
    });

    return () => {
      cancelled = true;
      responseSubscription?.remove();
    };
  }, []);
}

export default function RootLayout() {
  useNotificationNavigation();

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      void activateStatusOutbox(user?.uid || null).catch((error) => {
        console.error('Could not restore queued alert status changes:', error);
      });
    });
    const removeAppStateListener = addStatusOutboxAppStateListener();
    const retryTimer = setInterval(() => syncPendingStatusUpdates(), 15000);

    return () => {
      unsubscribeAuth();
      removeAppStateListener();
      clearInterval(retryTimer);
      void activateStatusOutbox(null).catch((error) => {
        console.error('Could not stop alert status sync:', error);
      });
    };
  }, []);

  return (
    <ThemeProvider value={DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="alert" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

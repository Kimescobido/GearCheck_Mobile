import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, serverTimestamp, collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { auth, db } from '../../../firebaseConfig';

const BADGE_SEEN_KEY = '@ppe-mobile/acknowledge-last-seen';

// Statuses that mean the alert is already handled — badge should NOT count these
const HANDLED_STATUSES = ['acknowledged', 'resolved', 'false alarm', 'unsafe', 'safe'];

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  const lastSeenRef = useRef<number>(0);

  // Load last-seen timestamp from storage on mount
  useEffect(() => {
    AsyncStorage.getItem(BADGE_SEEN_KEY).then((val) => {
      if (val) lastSeenRef.current = Number(val);
    }).catch(() => {});
  }, []);

  // When officer navigates TO the Acknowledge tab, mark all as seen
  useEffect(() => {
    if (pathname === '/acknowledge') {
      const now = Date.now();
      lastSeenRef.current = now;
      AsyncStorage.setItem(BADGE_SEEN_KEY, String(now)).catch(() => {});
      setPendingCount(0);
    }
  }, [pathname]);

  // Listen to recent alerts and count only NEW unseen ones
  useEffect(() => {
    const q = query(collection(db, 'ppe_alerts'), orderBy('timestamp', 'desc'), limit(40));
    const unsubscribeAlerts = onSnapshot(q, (snapshot) => {
      // Skip badge update if officer is currently on the Acknowledge tab
      if (pathname === '/acknowledge') {
        setPendingCount(0);
        return;
      }
      const count = snapshot.docs.filter((docSnap) => {
        const data = docSnap.data();
        // Only count if status is NOT already handled
        const s = (data.status || '').toLowerCase().trim();
        if (HANDLED_STATUSES.includes(s)) return false;
        // Only count alerts that arrived AFTER the last time officer saw them
        const ts: number = data.timestamp?.toMillis
          ? data.timestamp.toMillis()
          : (data.timestamp?.seconds ? data.timestamp.seconds * 1000 : 0);
        return ts > lastSeenRef.current;
      }).length;
      setPendingCount(count);
    }, (err) => {
      console.log('Badge listener error:', err);
    });
    return () => unsubscribeAlerts();
  }, [pathname]);

  // Auth guard — redirect to login if not signed in
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) router.replace('/login');
    });
    return unsubscribeAuth;
  }, [router]);

  useEffect(() => {
    async function registerForPushNotificationsAsync() {
      if (Platform.OS === 'web') return;

      // Expo Go on Android does not support remote push notifications (SDK 53+).
      // Keep the rest of the app usable there; push registration is enabled in
      // development and standalone builds.
      if (Constants.appOwnership === 'expo') {
        console.log('Remote push notifications require a development build.');
        return;
      }

      // Load only after the Expo Go check: the module itself throws in Expo Go
      // on Android, before an effect-level API guard can run.
      const Notifications = await import('expo-notifications');

      // Configure high-priority alert channel for Android
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Safety Violations',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF0000',
        });
      }

      if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        // Ask the user for permission if not already granted
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== 'granted') {
          console.log('Failed to get push token for push notification!');
          return;
        }

        // Generate the unique Expo Push Token for this phone
        const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
        const tokenData = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined
        );

        const pushToken = tokenData.data;
        console.log("Registered Expo Push Token:", pushToken);

        // Save the dynamic token to Firebase so the AI script can find it
        if (pushToken) {
          try {
            await setDoc(doc(db, 'officer_tokens', pushToken), {
              token: pushToken,
              officer_id: auth.currentUser?.uid || null,
              deviceModel: Device.modelName || 'Unknown Device',
              platform: Platform.OS,
              lastActive: serverTimestamp(),
            });
            console.log("Token successfully synced to Firestore!");
          } catch (error) {
            console.error("Error saving token to Firestore:", error);
          }
        }

      } else {
        console.log('Must use a physical device for Push Notifications');
      }
    }

    registerForPushNotificationsAsync().catch((error) => {
      console.error('Push notification registration failed:', error);
    });
  }, []);

  return (
    <>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={() => (
          <View style={styles.tabBarContainer}>

            <TouchableOpacity style={styles.tabItem} onPress={() => router.push('/')}>
              <Ionicons name={pathname === '/' ? 'alert-circle' : 'alert-circle-outline'} size={23} color={pathname === '/' ? '#5C4B4B' : '#888888'} />
              <Text style={[styles.tabLabel, { color: pathname === '/' ? '#5C4B4B' : '#888888' }]}>Alert</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tabItem} onPress={() => router.push('/acknowledge')}>
              <View style={styles.iconWrapper}>
                <Ionicons name={pathname === '/acknowledge' ? 'checkmark-circle' : 'checkmark-circle-outline'} size={23} color={pathname === '/acknowledge' ? '#5C4B4B' : '#888888'} />
                {pendingCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, { color: pathname === '/acknowledge' ? '#5C4B4B' : '#888888' }]}>Acknowledge</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tabItem} onPress={() => router.push('/logs')}>
              <Ionicons name={pathname === '/logs' ? 'archive' : 'archive-outline'} size={23} color={pathname === '/logs' ? '#5C4B4B' : '#888888'} />
              <Text style={[styles.tabLabel, { color: pathname === '/logs' ? '#5C4B4B' : '#888888' }]}>Logs</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tabItem} onPress={() => router.push('/analytics')}>
              <Ionicons name={pathname === '/analytics' ? 'pie-chart' : 'pie-chart-outline'} size={23} color={pathname === '/analytics' ? '#5C4B4B' : '#888888'} />
              <Text style={[styles.tabLabel, { color: pathname === '/analytics' ? '#5C4B4B' : '#888888' }]}>Analytics</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tabItem} onPress={() => router.push('/profile')}>
              <Ionicons name={pathname === '/profile' ? 'person-circle' : 'person-circle-outline'} size={23} color={pathname === '/profile' ? '#5C4B4B' : '#888888'} />
              <Text style={[styles.tabLabel, { color: pathname === '/profile' ? '#5C4B4B' : '#888888' }]}>Profile</Text>
            </TouchableOpacity>

          </View>
        )}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="acknowledge" />
        <Tabs.Screen name="logs" />
        <Tabs.Screen name="analytics" />
        <Tabs.Screen name="profile" />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  tabBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 72,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#E36B5D',
    borderRadius: 9,
    minWidth: 17,
    height: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 4,
  },
});

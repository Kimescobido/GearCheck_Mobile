import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../../firebaseConfig';


export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) router.replace('/login');
    });
    return unsubscribe;
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
              <Ionicons name={pathname === '/acknowledge' ? 'checkmark-circle' : 'checkmark-circle-outline'} size={23} color={pathname === '/acknowledge' ? '#5C4B4B' : '#888888'} />
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
  tabLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 4,
  },
});

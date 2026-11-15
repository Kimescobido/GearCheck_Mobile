import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebaseConfig';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    // Listens for existing token restored from AsyncStorage
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        // User is already logged in: bypass login screen
        router.replace('/(tabs)');
      } else {
        // No active session: go to login
        router.replace('/login');
      }
    });

    return () => unsubscribe();
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#7B7070" />
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#18181b',
  },
  logoContainer: {
    alignItems: 'center',

    marginBottom: 40,
  },
  brandText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 15,
    letterSpacing: 1.5,
  },
});
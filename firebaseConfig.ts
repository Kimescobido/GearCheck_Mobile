import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  initializeAuth,
  getAuth,
  Auth,
  // @ts-ignore Firebase's React Native entry point typing is not exposed in the web type map.
  getReactNativePersistence
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: "AIzaSyAGcxRo1o9neqaYmLDRY_oaIOmIPMFBaIk",
  authDomain: "ppe-detection-6b4b5.firebaseapp.com",
  projectId: "ppe-detection-6b4b5",
  storageBucket: "ppe-detection-6b4b5.firebasestorage.app",
  messagingSenderId: "492847927453",
  appId: "1:492847927453:web:486b9a30da7f5271170474",
  measurementId: "G-R3QBMQJEHQ"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let auth: Auth;
if (Platform.OS === 'web') {
  // React Native persistence is not available in the browser bundle.
  auth = getAuth(app);
} else {
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Fast Refresh can re-evaluate this module after Auth has already initialized.
    auth = getAuth(app);
  }
}

const db = getFirestore(app);

export { app, auth, db };

import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, indexedDBLocalPersistence } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const app = initializeApp(firebaseConfig);
const isNativePlatform = Capacitor.isNativePlatform();
export const auth = isNativePlatform
  ? initializeAuth(app, {
      persistence: indexedDBLocalPersistence,
    })
  : getAuth(app);

// Use persistent cache with multi‑tab synchronization to avoid
// failed-precondition errors and the deprecation warning.
// Guard against multiple initializeFirestore calls due to differing import paths
const __global = globalThis as any;
if (!__global.__FM_DB__) {
  __global.__FM_DB__ = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
}
export const db = __global.__FM_DB__;

// Region from env (Plan 2.0: europe-west1). Fallback to 'europe-west1'.
const FUNCTIONS_REGION = import.meta.env.VITE_FUNCTIONS_REGION || 'europe-west1';
export const functions = getFunctions(app, FUNCTIONS_REGION);
export const storage = getStorage(app, firebaseConfig.storageBucket);

// Optional: connect to emulator in dev if configured
if (import.meta.env.DEV && import.meta.env.VITE_USE_FUNCTIONS_EMULATOR === '1') {
  try {
    connectFunctionsEmulator(functions, 'localhost', 5001);
  } catch (e) {
    // no-op: emulator not running
  }
}

// App Check (ReCAPTCHA v3) — only if site key is provided
const APP_CHECK_SITE_KEY = import.meta.env.VITE_APPCHECK_SITE_KEY as string | undefined;
if (APP_CHECK_SITE_KEY) {
  try {
    // Optional debug token for local testing
    // @ts-ignore
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || undefined;
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    // swallow init errors; functions callable will surface if missing
  }
}

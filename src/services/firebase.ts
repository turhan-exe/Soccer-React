import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use persistent cache with multi‑tab synchronization to avoid
// failed-precondition errors and the deprecation warning.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// Region from env (Plan 2.0: europe-west1). Fallback to 'europe-west1'.
const FUNCTIONS_REGION = import.meta.env.VITE_FUNCTIONS_REGION || 'europe-west1';
export const functions = getFunctions(app, FUNCTIONS_REGION);

// Optional: connect to emulator in dev if configured
if (import.meta.env.DEV && import.meta.env.VITE_USE_FUNCTIONS_EMULATOR === '1') {
  try {
    connectFunctionsEmulator(functions, 'localhost', 5001);
  } catch (e) {
    // no-op: emulator not running
  }
}


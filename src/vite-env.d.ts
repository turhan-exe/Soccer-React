/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_FUNCTIONS_REGION?: string; // Plan 2.0: europe-west1
  readonly VITE_USE_FUNCTIONS_EMULATOR?: string; // '1' to enable in dev
  readonly VITE_CHAT_API_ENDPOINT?: string;
  readonly VITE_USERS_API_ENDPOINT?: string;
  readonly VITE_CHAT_SANCTION_ENDPOINT?: string;
  readonly VITE_CHAT_SANCTION_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

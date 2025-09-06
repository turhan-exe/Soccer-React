import { getApps, initializeApp } from 'firebase-admin/app';

// Centralized Firebase Admin initialization for all Cloud Functions modules.
// Import this module at the top of any file that uses firebase-admin.*
if (!getApps().length) {
  initializeApp();
}


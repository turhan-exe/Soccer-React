import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  OAuthProvider,
} from 'firebase/auth';
import type { FirebaseError } from 'firebase/app';
import { Capacitor } from '@capacitor/core';
import { auth } from './firebase';

export const signUp = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password);

export const signIn = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);

export const signOutUser = () => signOut(auth);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');

const isNativePlatform = Capacitor.isNativePlatform();

const isPopupRecoverable = (error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as FirebaseError).code ?? '')
      : '';
  return code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request';
};

export const signInWithGoogle = async () => {
  if (isNativePlatform) {
    return signInWithRedirect(auth, googleProvider);
  }

  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error) {
    if (isPopupRecoverable(error)) {
      console.warn('[auth] Popup sign-in failed, falling back to redirect', error);
      return signInWithRedirect(auth, googleProvider);
    }
    throw error;
  }
};

export const signInWithApple = () =>
  isNativePlatform ? signInWithRedirect(auth, appleProvider) : signInWithPopup(auth, appleProvider);

export const getAuthRedirectResult = () => getRedirectResult(auth);

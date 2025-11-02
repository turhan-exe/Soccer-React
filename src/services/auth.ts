import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  type UserCredential,
} from 'firebase/auth';
import type { FirebaseError } from 'firebase/app';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from './firebase';

export const signUp = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password);

export const signIn = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);

export const signOutUser = async () => {
  if (isNativePlatform) {
    try {
      await FirebaseAuthentication.signOut();
    } catch (error) {
      console.warn('[auth] Native sign-out failed or unavailable', error);
    }
  }
  await signOut(auth);
};

const buildGoogleProvider = () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
};

const buildAppleProvider = () => {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  return provider;
};

const googleProvider = buildGoogleProvider();
const appleProvider = buildAppleProvider();

const isNativePlatform = Capacitor.isNativePlatform();

const isPopupRecoverable = (error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as FirebaseError).code ?? '')
      : '';
  return code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request';
};

const signInWithGoogleNative = async (): Promise<UserCredential> => {
  const result = await FirebaseAuthentication.signInWithGoogle({
    skipNativeAuth: true,
    scopes: ['email', 'profile'],
    useCredentialManager: false,
  }).catch((error) => {
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      String((error as { message?: string }).message ?? '').toLowerCase().includes('unimplemented')
    ) {
      throw new Error(
        'Yerel Google girişi için Firebase Authentication eklentisi yüklenmemiş. Lütfen `npx cap sync` çalıştırın ve yerel projeyi yeniden derleyin.',
        { cause: error },
      );
    }
    throw error;
  });
  const { idToken, accessToken } = result.credential ?? {};
  if (!idToken && !accessToken) {
    throw new Error('Google oturum açma bilgileri alınamadı.');
  }
  return signInWithCredential(auth, GoogleAuthProvider.credential(idToken, accessToken));
};

export const signInWithGoogle = async () => {
  if (isNativePlatform) {
    return signInWithGoogleNative();
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

const signInWithAppleNative = async (): Promise<UserCredential> => {
  const result = await FirebaseAuthentication.signInWithApple({
    skipNativeAuth: true,
    scopes: ['email', 'name'],
  }).catch((error) => {
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      String((error as { message?: string }).message ?? '').toLowerCase().includes('unimplemented')
    ) {
      throw new Error(
        'Yerel Apple girişi için Firebase Authentication eklentisi yüklenmemiş. Lütfen `npx cap sync` çalıştırın ve yerel projeyi yeniden derleyin.',
        { cause: error },
      );
    }
    throw error;
  });
  const { idToken, nonce } = result.credential ?? {};
  if (!idToken) {
    throw new Error('Apple oturum açma bilgileri alınamadı.');
  }
  const provider = buildAppleProvider();
  const credential = provider.credential({
    idToken,
    rawNonce: nonce ?? undefined,
  });
  return signInWithCredential(auth, credential);
};

export const signInWithApple = () =>
  isNativePlatform ? signInWithAppleNative() : signInWithPopup(auth, appleProvider);

export const getAuthRedirectResult = (): Promise<UserCredential | null> =>
  isNativePlatform ? Promise.resolve(null) : getRedirectResult(auth);

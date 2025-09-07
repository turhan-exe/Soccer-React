import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
} from "firebase/auth";
import { auth } from "./firebase";

export const signUp = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password);

export const signIn = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);

export const signOutUser = () => signOut(auth);

const googleProvider = new GoogleAuthProvider();
export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);

const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');
export const signInWithApple = () => signInWithPopup(auth, appleProvider);

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export type UserProfile = {
  contactPhone: string | null;
  contactCrypto: string | null;
  role?: 'admin' | 'user';
};

const sanitizeContactField = (value: string | null | undefined, maxLength: number): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
};

const normalizeProfileField = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return null;
  }

  const data = snap.data();
  return {
    contactPhone: normalizeProfileField(data?.contactPhone),
    contactCrypto: normalizeProfileField(data?.contactCrypto),
    role: data?.role === 'admin' ? 'admin' : 'user',
  };
};

export const updateUserContactInfo = async (
  uid: string,
  payload: { phone?: string | null; crypto?: string | null },
): Promise<void> => {
  const update: Record<string, unknown> = {
    contactUpdatedAt: serverTimestamp(),
  };

  if (payload.phone !== undefined) {
    update.contactPhone = sanitizeContactField(payload.phone, 32);
  }

  if (payload.crypto !== undefined) {
    update.contactCrypto = sanitizeContactField(payload.crypto, 96);
  }

  await setDoc(doc(db, 'users', uid), update, { merge: true });
};

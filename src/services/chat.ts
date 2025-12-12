import { FirebaseError } from 'firebase/app';
import {
  addDoc,
  collection,
  DocumentData,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { GlobalChatMessage } from '@/types';
import { db, functions } from './firebase';

const GLOBAL_CHAT_COLLECTION = 'globalChatMessages';
const MESSAGE_HISTORY_LIMIT = 60;
const MESSAGE_TTL_HOURS = 24;
const MESSAGE_TTL_MS = MESSAGE_TTL_HOURS * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 320;

const chatCollectionRef = collection(db, GLOBAL_CHAT_COLLECTION);
const checkChatSanctionCallable = httpsCallable<{ userId: string }, ChatSanctionStatus>(functions, 'checkChatSanction');

type ChatSanctionStatus =
  | { allowed: true }
  | { allowed: false; type: 'timeout' | 'ban'; expiresAt?: number | null; reason?: string };

const toMillis = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  if (typeof value === 'object' && value !== null) {
    if ('toMillis' in (value as Timestamp)) {
      try {
        return (value as Timestamp).toMillis();
      } catch {
        return null;
      }
    }
    if ('toDate' in (value as { toDate: () => Date })) {
      try {
        return (value as { toDate: () => Date }).toDate().getTime();
      } catch {
        return null;
      }
    }
  }
  return null;
};

const ensureChatPermission = async (userId: string): Promise<void> => {
  if (!userId) {
    return;
  }

  try {
    const response = await checkChatSanctionCallable({ userId });
    const payload = response.data;
    if (payload.allowed) {
      return;
    }

    const remainingMs =
      typeof payload.expiresAt === 'number' && payload.expiresAt > Date.now()
        ? payload.expiresAt - Date.now()
        : null;
    const remainingMinutes = remainingMs ? Math.max(1, Math.ceil(remainingMs / 60000)) : null;

    if (payload.type === 'ban') {
      throw new Error(payload.reason ?? 'Bu hesap kalici olarak banlandi.');
    }

    const baseMessage = payload.reason ?? 'Bu hesap icin timeout aktif.';
    const durationInfo = remainingMinutes ? ` Kalan sure: ${remainingMinutes} dk.` : '';
    throw new Error(`${baseMessage}${durationInfo}`);
  } catch (error) {
    const firebaseError = error as FirebaseError | undefined;
    if (firebaseError?.code === 'functions/permission-denied' || firebaseError?.code === 'functions/unauthenticated') {
      throw new Error('Sohbet izni icin oturumunuz dogrulanamadi.');
    }

    if (firebaseError?.code?.startsWith('functions/')) {
      console.warn('[chat] checkChatSanction callable failed', firebaseError);
      return;
    }

    throw error;
  }
};

const ensureColor = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const documentToMessage = (docSnapshot: QueryDocumentSnapshot<DocumentData>): GlobalChatMessage => {
  const data = docSnapshot.data();
  const createdAtValue = data.createdAt;
  const expiresAtValue = data.expiresAt;
  const createdAt =
    createdAtValue instanceof Timestamp
      ? createdAtValue.toDate()
      : new Date(typeof createdAtValue === 'number' ? createdAtValue : Date.now());
  const expiresAt =
    expiresAtValue instanceof Timestamp
      ? expiresAtValue.toDate()
      : expiresAtValue
        ? new Date(expiresAtValue)
        : null;

  return {
    id: docSnapshot.id,
    text: String(data.text ?? ''),
    userId: String(data.userId ?? ''),
    username: String(data.username ?? 'Menajer'),
    teamName: String(data.teamName ?? 'Takimim'),
    createdAt,
    expiresAt,
    isVip: Boolean(data.isVip),
    gradientStart: ensureColor(data.gradientStart),
    gradientEnd: ensureColor(data.gradientEnd),
    gradientAngle: typeof data.gradientAngle === 'number' ? data.gradientAngle : null,
  };
};

const removeExpiredMessages = (messages: GlobalChatMessage[], now = Date.now()): GlobalChatMessage[] => {
  const ttlCutoff = now - MESSAGE_TTL_MS;
  return messages.filter(message => {
    const createdAtMs = message.createdAt.getTime();
    const expiresAtMs = message.expiresAt?.getTime();
    if (typeof expiresAtMs === 'number') {
      return expiresAtMs > now;
    }
    return createdAtMs > ttlCutoff;
  });
};

export const subscribeToGlobalChat = (
  onMessages: (messages: GlobalChatMessage[]) => void,
  onError?: (error: Error) => void,
) => {
  const chatQuery = query(chatCollectionRef, orderBy('createdAt', 'desc'), limit(MESSAGE_HISTORY_LIMIT));

  return onSnapshot(
    chatQuery,
    snapshot => {
      const items = snapshot.docs.map(documentToMessage).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const filteredItems = removeExpiredMessages(items);
      onMessages(filteredItems);
    },
    error => {
      console.warn('[chat] realtime subscription failed', error);
      onError?.(error);
    },
  );
};

type SendMessagePayload = {
  text: string;
  userId: string;
  username: string;
  teamName: string;
  isVip: boolean;
  gradientStart?: string;
  gradientEnd?: string;
  gradientAngle?: number;
};

const sanitizeOutgoingColor = (value: string | undefined, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const formatted = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(formatted)) {
    return formatted;
  }
  return fallback;
};

export const sendGlobalChatMessage = async ({
  text,
  userId,
  username,
  teamName,
  isVip,
  gradientStart,
  gradientEnd,
  gradientAngle,
}: SendMessagePayload) => {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Mesaj bos olamaz');
  }

  await ensureChatPermission(userId);

  const clipped = trimmed.length > MAX_TEXT_LENGTH ? trimmed.slice(0, MAX_TEXT_LENGTH) : trimmed;

  const payload: Record<string, unknown> = {
    text: clipped,
    userId,
    username,
    teamName,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + MESSAGE_TTL_MS),
    isVip,
  };

  if (isVip) {
    payload.gradientStart = sanitizeOutgoingColor(gradientStart, '#0ea5e9');
    payload.gradientEnd = sanitizeOutgoingColor(gradientEnd, '#9333ea');
    payload.gradientAngle = typeof gradientAngle === 'number' ? gradientAngle : Math.floor(Math.random() * 360);
  }

  await addDoc(chatCollectionRef, payload);
};

export type { GlobalChatMessage };

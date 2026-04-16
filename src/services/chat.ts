import { FirebaseError } from 'firebase/app';
import {
  addDoc,
  collection,
  DocumentData,
  limit,
  onSnapshot,
  orderBy,
  QueryConstraint,
  query,
  serverTimestamp,
  Timestamp,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { GlobalChatMessage } from '@/types';
import { db, functions } from './firebase';
import { resolveLiveTeamIdentities } from './teamIdentity';

const GLOBAL_CHAT_COLLECTION = 'globalChatMessages';
const MESSAGE_HISTORY_LIMIT = 60;
export const CHAT_RETENTION_DAYS = 7;
export const CHAT_RETENTION_MS = CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
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

    const blockedPayload = payload as Exclude<ChatSanctionStatus, { allowed: true }>;

    const remainingMs =
      typeof blockedPayload.expiresAt === 'number' && blockedPayload.expiresAt > Date.now()
        ? blockedPayload.expiresAt - Date.now()
        : null;
    const remainingMinutes = remainingMs ? Math.max(1, Math.ceil(remainingMs / 60000)) : null;

    if (blockedPayload.type === 'ban') {
      throw new Error(blockedPayload.reason ?? 'Bu hesap kalici olarak banlandi.');
    }

    const baseMessage = blockedPayload.reason ?? 'Bu hesap icin timeout aktif.';
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

const resolveChatDate = (value: unknown, fallbackMs = Date.now()): Date => {
  const millis = toMillis(value);
  return new Date(millis ?? fallbackMs);
};

export const getGlobalChatRetentionCutoffMs = (now = Date.now()): number =>
  now - CHAT_RETENTION_MS;

const documentToMessage = (docSnapshot: QueryDocumentSnapshot<DocumentData>): GlobalChatMessage => {
  const data = docSnapshot.data();

  return {
    id: docSnapshot.id,
    text: String(data.text ?? ''),
    userId: String(data.userId ?? ''),
    username: String(data.username ?? 'Menajer'),
    teamName: String(data.teamName ?? 'Takimim'),
    createdAt: resolveChatDate(data.createdAt),
    expiresAt: data.expiresAt ? resolveChatDate(data.expiresAt) : null,
    isVip: Boolean(data.isVip),
    gradientStart: ensureColor(data.gradientStart),
    gradientEnd: ensureColor(data.gradientEnd),
    gradientAngle: typeof data.gradientAngle === 'number' ? data.gradientAngle : null,
  };
};

export const isExpiredGlobalChatMessage = (
  message: Pick<GlobalChatMessage, 'createdAt' | 'expiresAt'>,
  now = Date.now(),
): boolean => {
  const expiresAtMs = message.expiresAt?.getTime();
  if (typeof expiresAtMs === 'number') {
    return expiresAtMs <= now;
  }

  return message.createdAt.getTime() <= getGlobalChatRetentionCutoffMs(now);
};

export const filterRetainedGlobalChatMessages = (
  messages: GlobalChatMessage[],
  now = Date.now(),
): GlobalChatMessage[] =>
  messages.filter(message => !isExpiredGlobalChatMessage(message, now));

const hydrateMessageTeamNames = async (messages: GlobalChatMessage[]): Promise<GlobalChatMessage[]> => {
  const liveIdentities = await resolveLiveTeamIdentities(messages.map((message) => message.userId));
  if (liveIdentities.size === 0) {
    return messages;
  }

  return messages.map((message) => {
    const identity = liveIdentities.get(message.userId);
    if (!identity?.teamName || identity.teamName === message.teamName) {
      return message;
    }

    return {
      ...message,
      teamName: identity.teamName,
    };
  });
};

type SubscribeToGlobalChatOptions = {
  limitCount?: number;
  sinceMs?: number;
};

export const subscribeToGlobalChat = (
  onMessages: (messages: GlobalChatMessage[]) => void,
  onError?: (error: Error) => void,
  options: SubscribeToGlobalChatOptions = {},
) => {
  const queryConstraints: QueryConstraint[] = [];
  if (typeof options.sinceMs === 'number' && Number.isFinite(options.sinceMs)) {
    queryConstraints.push(where('createdAt', '>=', Timestamp.fromMillis(options.sinceMs)));
  }
  queryConstraints.push(orderBy('createdAt', 'desc'));
  queryConstraints.push(limit(options.limitCount ?? MESSAGE_HISTORY_LIMIT));

  const chatQuery = query(chatCollectionRef, ...queryConstraints);
  let closed = false;
  let hydrateSequence = 0;

  const unsubscribe = onSnapshot(
    chatQuery,
    snapshot => {
      const currentSequence = ++hydrateSequence;

      void (async () => {
        const items = snapshot.docs
          .map(documentToMessage)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const filteredItems = filterRetainedGlobalChatMessages(items);
        const hydratedItems = await hydrateMessageTeamNames(filteredItems);

        if (closed || currentSequence !== hydrateSequence) {
          return;
        }

        onMessages(hydratedItems);
      })();
    },
    error => {
      console.warn('[chat] realtime subscription failed', error);
      onError?.(error);
    },
  );

  return () => {
    closed = true;
    unsubscribe();
  };
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
    expiresAt: Timestamp.fromMillis(Date.now() + CHAT_RETENTION_MS),
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

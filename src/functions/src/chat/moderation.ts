import * as functions from 'firebase-functions/v1';
import '../_firebase.js';
import { randomUUID } from 'node:crypto';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

const REGION = 'europe-west1';
const db = getFirestore();
const SANCTIONS_COLLECTION = 'chatSanctions';
const MODERATION_LOGS = 'chatModerationLogs';
const ADMIN_SHARED_SECRET =
  process.env.CHAT_ADMIN_SECRET ||
  (functions.config()?.moderation?.secret as string | undefined) ||
  '';
const ADMIN_ALLOWED_ORIGIN =
  process.env.CHAT_ADMIN_ORIGIN ||
  (functions.config()?.moderation?.origin as string | undefined) ||
  '*';

type ChatSanction = {
  type: 'timeout' | 'ban';
  reason?: string;
  expiresAt?: number | Timestamp | null;
  aliases?: string[] | null;
};

type SanctionRecord = {
  ref: FirebaseFirestore.DocumentReference;
  data: ChatSanction;
};

const toMillis = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  if (typeof value === 'object' && 'toMillis' in (value as Timestamp)) {
    try {
      return (value as Timestamp).toMillis();
    } catch {
      return null;
    }
  }
  return null;
};

const sanitizeLookupKey = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.replace(/[^a-zA-Z0-9]/g, '').trim();
  return trimmed || null;
};

const clampDurationMinutes = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 15;
  }
  return Math.max(1, Math.min(1440, Math.round(numeric)));
};

const resolveAllowedOrigin = (value: string): string => {
  if (!value || value === '*') {
    return '*';
  }

  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return value.includes('/') ? value.split('/')[0] : value;
  }
};

const setCorsHeaders = (res: functions.Response<any>) => {
  const resolvedOrigin = resolveAllowedOrigin(ADMIN_ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Origin', resolvedOrigin || '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
};

const resolveSanctionRecord = async (identifier: string | null): Promise<SanctionRecord | null> => {
  if (!identifier) {
    return null;
  }

  const directRef = db.doc(`${SANCTIONS_COLLECTION}/${identifier}`);
  const directSnap = await directRef.get();
  if (directSnap.exists) {
    return { ref: directRef, data: directSnap.data() as ChatSanction };
  }

  const aliasSnapshot = await db
    .collection(SANCTIONS_COLLECTION)
    .where('aliases', 'array-contains', identifier)
    .limit(1)
    .get();

  if (!aliasSnapshot.empty) {
    const docSnap = aliasSnapshot.docs[0];
    return { ref: docSnap.ref, data: docSnap.data() as ChatSanction };
  }

  return null;
};

const evaluateSanction = (sanction: ChatSanction) => {
  const expiresAt = toMillis(sanction.expiresAt);
  const now = Date.now();

  if (sanction.type === 'ban') {
    return { active: true, type: 'ban' as const, expiresAt: null };
  }

  if (sanction.type === 'timeout' && (expiresAt === null || expiresAt > now)) {
    return { active: true, type: 'timeout' as const, expiresAt };
  }

  return { active: false, type: sanction.type, expiresAt };
};

export const enforceChatModeration = functions
  .region(REGION)
  .firestore.document('globalChatMessages/{messageId}')
  .onCreate(async (snap) => {
    const data = snap.data();
    const userId = typeof data.userId === 'string' && data.userId.trim().length > 0 ? data.userId.trim() : null;

    const candidateKeys: string[] = [];
    if (userId) {
      candidateKeys.push(userId);
    }
    const fallbackUserTag = sanitizeLookupKey((data as { userTag?: string } | null)?.userTag ?? null);
    if (fallbackUserTag) {
      candidateKeys.push(fallbackUserTag);
    }
    const fallbackUsername = sanitizeLookupKey((data as { username?: string } | null)?.username ?? null);
    if (fallbackUsername) {
      candidateKeys.push(fallbackUsername);
    }
    const fallbackTeam = sanitizeLookupKey((data as { teamName?: string } | null)?.teamName ?? null);
    if (fallbackTeam) {
      candidateKeys.push(fallbackTeam);
    }

    if (candidateKeys.length === 0) {
      return;
    }

    let sanctionRecord: Awaited<ReturnType<typeof resolveSanctionRecord>> | null = null;
    for (const identifier of candidateKeys) {
      sanctionRecord = await resolveSanctionRecord(identifier);
      if (sanctionRecord) {
        break;
      }
    }

    if (!sanctionRecord) {
      return;
    }

    const sanction = sanctionRecord.data;
    const sanctionRef = sanctionRecord.ref;
    const expiresAt = toMillis(sanction.expiresAt);
    const now = Date.now();

    const isBan = sanction.type === 'ban';
    const isTimeout = sanction.type === 'timeout' && (expiresAt === null || expiresAt > now);

    if (!isBan && !isTimeout) {
      // Expired timeout; clear the sanction doc.
      await sanctionRef.delete().catch(() => undefined);
      return;
    }

    await snap.ref.delete();

    await db.collection(MODERATION_LOGS).add({
      messageId: snap.id,
      userId,
      username: data.username ?? null,
      teamName: data.teamName ?? null,
      text: data.text ?? '',
      type: sanction.type,
      reason: sanction.reason ?? 'Auto enforced',
      enforcedAt: FieldValue.serverTimestamp(),
    });
  });

export const checkChatSanction = functions
  .region(REGION)
  .https.onCall(async (payload: { userId?: string | null }, context) => {
    const requesterId = context.auth?.uid ?? null;
    if (!requesterId) {
      throw new functions.https.HttpsError('unauthenticated', 'Oturum acmadan mesaj gonderemezsiniz.');
    }

    const rawUserId = typeof payload?.userId === 'string' ? payload.userId.trim() : '';
    const targetUserId = rawUserId || requesterId;

    if (targetUserId !== requesterId) {
      throw new functions.https.HttpsError('permission-denied', 'Yalnizca kendi hesabinizin durumunu sorgulayabilirsiniz.');
    }

    const record =
      (await resolveSanctionRecord(targetUserId)) ||
      (await resolveSanctionRecord(sanitizeLookupKey(targetUserId)));

    if (!record) {
      return { allowed: true as const };
    }

    const status = evaluateSanction(record.data);
    if (!status.active) {
      await record.ref.delete().catch(() => undefined);
      return { allowed: true as const };
    }

    return {
      allowed: false as const,
      type: status.type,
      expiresAt: status.expiresAt,
      reason: record.data.reason ?? 'Genel davranis politikasi ihlali',
    };
  });

export const applyChatSanction = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).set('Allow', 'POST, OPTIONS').send('Method Not Allowed');
      return;
    }

    const sharedSecret = ADMIN_SHARED_SECRET;
    if (!sharedSecret) {
      console.error('[chat] moderation secret missing');
      res.status(500).json({ error: 'CONFIG', message: 'Sunucu moderasyon anahtari tanimli degil.' });
      return;
    }

    const providedSecret = req.header('x-admin-secret');
    if (!providedSecret || providedSecret !== sharedSecret) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Yetkisiz istek.' });
      return;
    }

    try {
      const body = (req.body ?? {}) as {
        action?: 'timeout' | 'ban';
        reason?: string;
        durationMinutes?: number | null;
        message?: {
          id?: string;
          userId?: string | null;
          playerTag?: string | null;
          playerName?: string | null;
        };
      };

      const action: 'timeout' | 'ban' = body.action === 'ban' ? 'ban' : 'timeout';
      const durationMinutes = action === 'ban' ? null : clampDurationMinutes(body.durationMinutes ?? 15);
      const messagePayload = body.message ?? {};

      const rawUserId = typeof messagePayload.userId === 'string' ? messagePayload.userId.trim() : '';
      const playerTag = typeof messagePayload.playerTag === 'string' ? messagePayload.playerTag : '0000';
      const playerName = typeof messagePayload.playerName === 'string' ? messagePayload.playerName : 'Bilinmeyen';
      const reason = typeof body.reason === 'string' && body.reason.trim().length > 0 ? body.reason.trim().slice(0, 280) : 'Belirtilmedi';

      const aliasSet = new Set<string>();
      [rawUserId, playerTag, messagePayload.id ?? null, playerName].forEach((candidate) => {
        const sanitized = sanitizeLookupKey(candidate);
        if (sanitized) {
          aliasSet.add(sanitized);
        }
      });

      const sanctionId =
        sanitizeLookupKey(rawUserId) ||
        sanitizeLookupKey(playerTag) ||
        sanitizeLookupKey(messagePayload.id ?? null) ||
        randomUUID();

      const payload: Record<string, unknown> = {
        userId: rawUserId || null,
        userTag: playerTag,
        userName: playerName,
        reason,
        type: action,
        aliases: Array.from(aliasSet),
        startedAt: FieldValue.serverTimestamp(),
      };

      if (action === 'timeout' && typeof durationMinutes === 'number') {
        payload.expiresAt = Timestamp.fromMillis(Date.now() + durationMinutes * 60 * 1000);
      } else {
        payload.expiresAt = null;
      }

      await db.doc(`${SANCTIONS_COLLECTION}/${sanctionId}`).set(payload, { merge: true });
      res.status(200).json({ success: true, id: sanctionId });
    } catch (error) {
      console.error('[chat] applyChatSanction failed', error);
      res.status(500).json({ error: 'SERVER_ERROR', message: 'Moderasyon kaydedilemedi.' });
    }
  });

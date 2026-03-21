import * as functions from 'firebase-functions/v1';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const db = getFirestore();
const messaging = getMessaging();
const PUSH_CHANNEL_ID = 'fhs-events';

type PushPayload = {
  type: string;
  title: string;
  body: string;
  path?: string;
  data?: Record<string, unknown>;
};

const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

const stringifyData = (data: Record<string, unknown>): Record<string, string> => {
  const entries = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, value] as const;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return [key, String(value)] as const;
      }
      return [key, JSON.stringify(value)] as const;
    });
  return Object.fromEntries(entries);
};

export async function sendPushToUser(
  uid: string,
  payload: PushPayload,
  dedupeKey: string,
) {
  const notificationRef = db.doc(`users/${uid}/notifications/${dedupeKey}`);

  try {
    await notificationRef.create({
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      path: payload.path || null,
      dedupeKey,
      createdAt: FieldValue.serverTimestamp(),
      status: 'pending',
    });
  } catch (error: any) {
    if (error?.code === 6 || /already exists/i.test(error?.message || '')) {
      return { ok: true, deduped: true, status: 'skipped' as const };
    }
    throw error;
  }

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    await notificationRef.set(
      {
        status: 'skipped',
        skippedReason: 'missing-user',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, status: 'skipped' as const };
  }

  const userData = userSnap.data() as any;
  if (userData?.notificationPrefs?.pushEnabled === false) {
    await notificationRef.set(
      {
        status: 'skipped',
        skippedReason: 'push-disabled',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, status: 'skipped' as const };
  }

  const devicesSnap = await userRef.collection('devices').get();
  const activeDevices = devicesSnap.docs.filter((doc) => {
    const data = doc.data() as any;
    return data?.pushEnabled !== false && typeof data?.fcmToken === 'string' && data.fcmToken.trim();
  });

  if (activeDevices.length === 0) {
    await notificationRef.set(
      {
        status: 'skipped',
        skippedReason: 'no-active-devices',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, status: 'skipped' as const };
  }

  const tokens = activeDevices
    .map((doc) => String((doc.data() as any).fcmToken || '').trim())
    .filter(Boolean);

  try {
    const result = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: stringifyData({
        type: payload.type,
        path: payload.path || '',
        ...(payload.data || {}),
      }),
      android: {
        priority: 'high',
        notification: {
          channelId: PUSH_CHANNEL_ID,
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });

    const responseSummaries = result.responses.map((response, index) => ({
      deviceId: activeDevices[index]?.id ?? null,
      success: response.success,
      messageId: response.success ? response.messageId ?? null : null,
      errorCode: response.error?.code ?? null,
      errorMessage: response.error?.message ?? null,
    }));

    const invalidDeviceRefs = activeDevices
      .map((doc, index) => {
        const response = result.responses[index];
        const code = response?.error?.code || '';
        return INVALID_TOKEN_CODES.has(code) ? doc.ref : null;
      })
      .filter((ref): ref is FirebaseFirestore.DocumentReference => Boolean(ref));

    if (invalidDeviceRefs.length > 0) {
      const batch = db.batch();
      invalidDeviceRefs.forEach((ref) => batch.delete(ref));
      await batch.commit();
    }

    await notificationRef.set(
      {
        status: result.successCount > 0 ? 'sent' : 'skipped',
        successCount: result.successCount,
        failureCount: result.failureCount,
        responseSummaries,
        sentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (result.failureCount > 0) {
      functions.logger.warn('[notify.sendPushToUser] partial failure', {
        uid,
        dedupeKey,
        responseSummaries,
      });
    }

    return {
      ok: true,
      status: result.successCount > 0 ? 'sent' as const : 'skipped' as const,
      successCount: result.successCount,
      failureCount: result.failureCount,
    };
  } catch (error: any) {
    functions.logger.error('[notify.sendPushToUser] failed', {
      uid,
      dedupeKey,
      error: error?.message || String(error),
    });
    await notificationRef.set(
      {
        status: 'skipped',
        skippedReason: 'send-failed',
        error: error?.message || String(error),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: false, status: 'skipped' as const };
  }
}

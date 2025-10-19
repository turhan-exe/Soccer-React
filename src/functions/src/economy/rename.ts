import * as functions from 'firebase-functions/v1';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import '../_firebase.js';

const db = getFirestore();

const CLUB_RENAME_COST = 300;
const STADIUM_RENAME_COST = 220;
const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 32;

type RenameTarget = 'club' | 'stadium';

const sanitizeName = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Yeni isim metin olarak gönderilmelidir.');
  }
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length < MIN_NAME_LENGTH) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `İsim en az ${MIN_NAME_LENGTH} karakter olmalıdır.`,
    );
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `İsim en fazla ${MAX_NAME_LENGTH} karakter olabilir.`,
    );
  }
  return trimmed;
};

const validateAuth = (context: functions.https.CallableContext): string => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Bu işlem için oturum açmanız gerekir.');
  }
  return uid;
};

const buildAuditEntry = (
  uid: string,
  action: RenameTarget,
  cost: number,
  newValue: string,
) => ({
  userId: uid,
  action: action === 'club' ? 'clubRename' : 'stadiumRename',
  cost,
  newValue,
  createdAt: FieldValue.serverTimestamp(),
});

const performRename = async (uid: string, target: RenameTarget, newName: string, cost: number) => {
  const userRef = db.collection('users').doc(uid);
  const teamRef = db.collection('teams').doc(uid);
  const auditRef = db.collection('economyLogs').doc();

  let updatedBalance = 0;

  await db.runTransaction(async (tx) => {
    const [userSnap, teamSnap] = await Promise.all([tx.get(userRef), tx.get(teamRef)]);

    if (!userSnap.exists) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Kullanıcı profili bulunamadı.',
      );
    }
    if (!teamSnap.exists) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Takım bilgisi bulunamadı.',
      );
    }

    const ownerUid = teamSnap.get('ownerUid');
    if (ownerUid !== uid) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Yalnızca kendi kulübünüzde değişiklik yapabilirsiniz.',
      );
    }

    const balance = Number(userSnap.get('diamondBalance') ?? 0);
    if (Number.isNaN(balance) || balance < cost) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Yetersiz elmas bakiyesi.',
      );
    }

    const currentName =
      target === 'club'
        ? teamSnap.get('name')
        : teamSnap.get('stadium')?.name ?? null;
    if (typeof currentName === 'string' && currentName.trim() === newName) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Yeni isim mevcut isimle aynı.',
      );
    }

    updatedBalance = balance - cost;
    tx.update(userRef, { diamondBalance: updatedBalance });

    if (target === 'club') {
      tx.update(teamRef, {
        name: newName,
        nameUpdatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(
        teamRef,
        {
          stadium: {
            name: newName,
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );
    }

    tx.set(auditRef, buildAuditEntry(uid, target, cost, newName));
  });

  return {
    diamondBalance: updatedBalance,
    ...(target === 'club' ? { teamName: newName } : { stadiumName: newName }),
  };
};

export const renameClub = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    const uid = validateAuth(context);
    const newName = sanitizeName(data?.name);
    return performRename(uid, 'club', newName, CLUB_RENAME_COST);
  });

export const renameStadium = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    const uid = validateAuth(context);
    const newName = sanitizeName(data?.name);
    return performRename(uid, 'stadium', newName, STADIUM_RENAME_COST);
  });

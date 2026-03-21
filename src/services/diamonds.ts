import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  Unsubscribe,
  runTransaction,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import { toast } from 'sonner';
import { getDiamondPackByProductId } from '@/features/diamonds/packs';
import { listOwnedPlayBillingPurchases } from './playBilling';

type FinalizeAndroidDiamondPurchasePayload = {
  productId: string;
  purchaseToken: string;
  orderId?: string | null;
  packageName?: string | null;
};

export type FinalizeAndroidDiamondPurchaseResponse = {
  purchaseId: string;
  productId: string;
  packId: string;
  amount: number;
  diamondBalance: number;
  granted: boolean;
  alreadyProcessed: boolean;
  consumeAttempted: boolean;
  consumed: boolean;
};

const finalizeAndroidDiamondPurchaseCallable = httpsCallable<
  FinalizeAndroidDiamondPurchasePayload,
  FinalizeAndroidDiamondPurchaseResponse
>(functions, 'finalizeAndroidDiamondPurchase');

export async function ensureUserDoc(uid: string): Promise<void> {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { diamondBalance: 0 });
  }
}

export function listenDiamondBalance(
  uid: string,
  cb: (balance: number) => void,
): Unsubscribe {
  const ref = doc(db, 'users', uid);
  return onSnapshot(ref, (snap) => {
    const data = snap.data();
    cb(data?.diamondBalance ?? 0);
  });
}

export async function finalizeAndroidDiamondPurchase(
  payload: FinalizeAndroidDiamondPurchasePayload,
): Promise<FinalizeAndroidDiamondPurchaseResponse> {
  const response = await finalizeAndroidDiamondPurchaseCallable(payload);
  return response.data;
}

export async function syncPendingAndroidDiamondPurchases(): Promise<{
  processed: number;
  pending: number;
  skipped: number;
}> {
  const purchases = await listOwnedPlayBillingPurchases();
  let processed = 0;
  let pending = 0;
  let skipped = 0;
  let firstError: Error | null = null;

  for (const purchase of purchases) {
    const productId = purchase.productId?.trim() ?? '';
    const purchaseToken = purchase.purchaseToken?.trim() ?? '';
    const pack = getDiamondPackByProductId(productId);

    if (!pack || !purchaseToken) {
      skipped += 1;
      continue;
    }

    if (purchase.purchaseState === 'PENDING' || purchase.status === 'pending') {
      pending += 1;
      continue;
    }

    if (purchase.purchaseState !== 'PURCHASED' && purchase.status !== 'purchased') {
      skipped += 1;
      continue;
    }

    try {
      await finalizeAndroidDiamondPurchase({
        productId,
        purchaseToken,
        orderId: purchase.orderId ?? null,
        packageName: purchase.packageName ?? null,
      });
      processed += 1;
    } catch (error) {
      console.warn('[diamonds] pending purchase finalize failed', error);
      if (!firstError) {
        firstError = error as Error;
      }
    }
  }

  if (firstError) {
    throw firstError;
  }

  return { processed, pending, skipped };
}

export async function spendDiamonds(uid: string, amount: number): Promise<void> {
  const userRef = doc(db, 'users', uid);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      const balance = Number(snap.data()?.diamondBalance ?? 0);
      if (balance < amount) {
        throw new Error('Yeterli elmas yok');
      }
      tx.set(
        userRef,
        { diamondBalance: Math.max(0, Math.round(balance - amount)) },
        { merge: true },
      );
    });
  } catch (err) {
    console.warn(err);
    toast.error('Yeterli elmas yok');
    throw err;
  }
}

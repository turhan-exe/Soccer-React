import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { listOwnedPlayBillingPurchases } from './playBilling';
import { getCreditPackByProductId } from '@/features/finance/creditPacks';

type FinalizeAndroidCreditPurchasePayload = {
  productId: string;
  purchaseToken: string;
  orderId?: string | null;
  packageName?: string | null;
};

export type FinalizeAndroidCreditPurchaseResponse = {
  purchaseId: string;
  productId: string;
  packId: string;
  amount: number;
  balance: number;
  granted: boolean;
  alreadyProcessed: boolean;
  consumeAttempted: boolean;
  consumed: boolean;
  consumeError?: string | null;
};

const finalizeAndroidCreditPurchaseCallable = httpsCallable<
  FinalizeAndroidCreditPurchasePayload,
  FinalizeAndroidCreditPurchaseResponse
>(functions, 'finalizeAndroidCreditPurchase');

export async function finalizeAndroidCreditPurchase(
  payload: FinalizeAndroidCreditPurchasePayload,
): Promise<FinalizeAndroidCreditPurchaseResponse> {
  const response = await finalizeAndroidCreditPurchaseCallable(payload);
  return response.data;
}

export async function syncPendingAndroidCreditPurchases(): Promise<{
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
    const pack = getCreditPackByProductId(productId);

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
      await finalizeAndroidCreditPurchase({
        productId,
        purchaseToken,
        orderId: purchase.orderId ?? null,
        packageName: purchase.packageName ?? null,
      });
      processed += 1;
    } catch (error) {
      console.warn('[creditPurchases] pending purchase finalize failed', error);
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

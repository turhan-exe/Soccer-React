import { httpsCallable } from 'firebase/functions';
import type { SponsorCatalogEntry } from '@/services/finance';
import { functions } from './firebase';
import { listOwnedPlayBillingPurchases } from './playBilling';
import { buildSponsorStoreProductId } from '@/features/finance/sponsorCatalogUtils';

type FinalizeAndroidSponsorPurchasePayload = {
  sponsorId: string;
  productId: string;
  purchaseToken: string;
  orderId?: string | null;
  packageName?: string | null;
};

export type FinalizeAndroidSponsorPurchaseResponse = {
  purchaseId: string;
  sponsorId: string;
  sponsorName: string;
  productId: string;
  granted: boolean;
  alreadyProcessed: boolean;
  consumeAttempted: boolean;
  consumed: boolean;
  consumeError?: string | null;
};

const finalizeAndroidSponsorPurchaseCallable = httpsCallable<
  FinalizeAndroidSponsorPurchasePayload,
  FinalizeAndroidSponsorPurchaseResponse
>(functions, 'finalizeAndroidSponsorPurchase');

export async function finalizeAndroidSponsorPurchase(
  payload: FinalizeAndroidSponsorPurchasePayload,
): Promise<FinalizeAndroidSponsorPurchaseResponse> {
  const response = await finalizeAndroidSponsorPurchaseCallable(payload);
  return response.data;
}

export async function syncPendingAndroidSponsorPurchases(
  entries: SponsorCatalogEntry[],
): Promise<{ processed: number; pending: number; skipped: number }> {
  const purchases = await listOwnedPlayBillingPurchases();
  const productIdToSponsorId = Object.fromEntries(
    entries
      .filter((entry) => entry.type === 'premium')
      .map((entry) => [buildSponsorStoreProductId(entry), entry.id])
      .filter(([productId]) => Boolean(productId)),
  );

  let processed = 0;
  let pending = 0;
  let skipped = 0;
  let firstError: Error | null = null;

  for (const purchase of purchases) {
    const productId = purchase.productId?.trim() ?? '';
    const purchaseToken = purchase.purchaseToken?.trim() ?? '';
    const sponsorId = productIdToSponsorId[productId];

    if (!sponsorId || !purchaseToken) {
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
      await finalizeAndroidSponsorPurchase({
        sponsorId,
        productId,
        purchaseToken,
        orderId: purchase.orderId ?? null,
        packageName: purchase.packageName ?? null,
      });
      processed += 1;
    } catch (error) {
      console.warn('[sponsorPurchases] pending purchase finalize failed', error);
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

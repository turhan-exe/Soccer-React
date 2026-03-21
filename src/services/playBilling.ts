import { Capacitor, registerPlugin } from '@capacitor/core';

export type PlayBillingProduct = {
  productId: string;
  title?: string;
  description?: string;
  formattedPrice?: string;
  priceCurrencyCode?: string;
  priceAmountMicros?: number;
};

export type PlayBillingPurchaseState = 'PURCHASED' | 'PENDING' | 'UNSPECIFIED_STATE';

export type PlayBillingPurchaseResult = {
  status: 'purchased' | 'pending' | 'cancelled';
  productId: string;
  products?: string[];
  orderId?: string;
  packageName?: string;
  purchaseToken?: string;
  purchaseState: PlayBillingPurchaseState;
  acknowledged: boolean;
  autoRenewing?: boolean;
  quantity?: number;
  purchaseTime?: number;
  responseCode?: number;
  debugMessage?: string;
};

type PlayBillingPlugin = {
  listProducts(payload: { productIds: string[] }): Promise<{ products: PlayBillingProduct[] }>;
  purchase(payload: {
    productId: string;
    obfuscatedAccountId?: string;
    obfuscatedProfileId?: string;
  }): Promise<PlayBillingPurchaseResult>;
  listOwnedPurchases(): Promise<{ purchases: PlayBillingPurchaseResult[] }>;
  consumePurchase(payload: { purchaseToken: string }): Promise<{ ok: boolean; purchaseToken: string }>;
};

const PlayBilling = registerPlugin<PlayBillingPlugin>('PlayBilling');

export function isNativeAndroidPlayBillingSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function getPlayBillingUnavailableMessage(): string {
  return 'Google Play odeme sadece Android uygulamasinda kullanilabilir.';
}

export async function loadPlayBillingProducts(
  productIds: string[],
): Promise<Record<string, PlayBillingProduct>> {
  if (!isNativeAndroidPlayBillingSupported()) {
    return {};
  }

  const uniqueIds = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return {};
  }

  const response = await PlayBilling.listProducts({ productIds: uniqueIds });
  return Object.fromEntries((response.products ?? []).map((product) => [product.productId, product]));
}

export async function startPlayBillingPurchase(payload: {
  productId: string;
  obfuscatedAccountId: string;
  obfuscatedProfileId?: string;
}): Promise<PlayBillingPurchaseResult> {
  if (!isNativeAndroidPlayBillingSupported()) {
    throw new Error(getPlayBillingUnavailableMessage());
  }

  const response = await PlayBilling.purchase(payload);
  return response;
}

export async function listOwnedPlayBillingPurchases(): Promise<PlayBillingPurchaseResult[]> {
  if (!isNativeAndroidPlayBillingSupported()) {
    return [];
  }

  const response = await PlayBilling.listOwnedPurchases();
  return response.purchases ?? [];
}

export async function consumeOwnedPlayBillingPurchase(purchaseToken: string): Promise<void> {
  if (!isNativeAndroidPlayBillingSupported()) {
    return;
  }

  await PlayBilling.consumePurchase({ purchaseToken });
}

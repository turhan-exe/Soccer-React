import type { CreditPackage } from '@/services/finance';

export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: 'credit-10k', productId: 'credits_10000', price: 9.99, amount: 10_000 },
  { id: 'credit-25k', productId: 'credits_25000', price: 19.99, amount: 25_000 },
  { id: 'credit-60k', productId: 'credits_60000', price: 49.99, amount: 60_000 },
];

const CREDIT_PACKAGES_BY_PRODUCT_ID = Object.fromEntries(
  CREDIT_PACKAGES.map((pack) => [pack.productId, pack]),
);

export function getCreditPackByProductId(productId: string): CreditPackage | null {
  return CREDIT_PACKAGES_BY_PRODUCT_ID[productId] ?? null;
}

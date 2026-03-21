export type DiamondPackId = 'small' | 'medium' | 'large' | 'mega';

export type DiamondPack = {
  id: DiamondPackId;
  productId: string;
  amount: number;
  priceFiat?: number;
  label: string;
  bestDeal?: boolean;
};

export const DIAMOND_PACKS: DiamondPack[] = [
  { id: 'small', productId: 'diamonds_small', amount: 200, priceFiat: 39.99, label: 'Small' },
  {
    id: 'medium',
    productId: 'diamonds_medium',
    amount: 900,
    priceFiat: 199.99,
    label: 'Medium',
    bestDeal: true,
  },
  {
    id: 'large',
    productId: 'diamonds_large',
    amount: 2800,
    priceFiat: 399.99,
    label: 'Large',
  },
  {
    id: 'mega',
    productId: 'diamonds_mega',
    amount: 6000,
    priceFiat: 749.99,
    label: 'Mega',
  },
];

export const DIAMOND_PACKS_BY_ID = Object.fromEntries(
  DIAMOND_PACKS.map((pack) => [pack.id, pack]),
) as Record<DiamondPackId, DiamondPack>;

export const DIAMOND_PACKS_BY_PRODUCT_ID = Object.fromEntries(
  DIAMOND_PACKS.map((pack) => [pack.productId, pack]),
) as Record<string, DiamondPack>;

export function getDiamondPackByProductId(productId: string): DiamondPack | null {
  return DIAMOND_PACKS_BY_PRODUCT_ID[productId] ?? null;
}

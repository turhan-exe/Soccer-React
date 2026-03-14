export type DiamondPack = {
  id: 'small' | 'medium' | 'large' | 'mega';
  amount: number;
  priceFiat?: number;
  label: string;
  bestDeal?: boolean;
};

export const DIAMOND_PACKS: DiamondPack[] = [
  { id: 'small', amount: 200, priceFiat: 39.99, label: 'Small' },
  { id: 'medium', amount: 900, priceFiat: 199.99, label: 'Medium', bestDeal: true },
  { id: 'large', amount: 2800, priceFiat: 399.99, label: 'Large' },
  { id: 'mega', amount: 6000, priceFiat: 749.99, label: 'Mega' },
];

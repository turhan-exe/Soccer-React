export type DiamondPack = {
  id: 'small' | 'medium' | 'large' | 'mega';
  amount: number;
  priceFiat?: number;
  label: string;
  bestDeal?: boolean;
};

export const DIAMOND_PACKS: DiamondPack[] = [
  { id: 'small', amount: 80, priceFiat: 39.99, label: 'Small' },
  { id: 'medium', amount: 500, priceFiat: 199.99, label: 'Medium', bestDeal: true },
  { id: 'large', amount: 1200, priceFiat: 399.99, label: 'Large' },
  { id: 'mega', amount: 2500, priceFiat: 749.99, label: 'Mega' },
];

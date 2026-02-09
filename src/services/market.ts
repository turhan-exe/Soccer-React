import {
  collection,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';

export const LISTINGS_PATH = 'transferListings';

export type SortKey =
  | 'overall_desc'
  | 'overall_asc'
  | 'price_asc'
  | 'price_desc'
  | 'pos_asc'
  | 'pos_desc'
  | 'name_asc'
  | 'name_desc'
  | 'seller_asc'
  | 'seller_desc'
  | 'newest';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const resolveTake = (take?: number) => {
  if (!isFiniteNumber(take)) return 100;
  const rounded = Math.floor(take);
  return Math.min(Math.max(rounded, 1), 500);
};

export function buildTransferListingsQuery(
  db: Firestore,
  opts: { pos?: string | 'ALL'; maxPrice?: number; sort?: SortKey; take?: number } = {},
) {
  const { pos, maxPrice, sort = 'overall_desc', take } = opts;

  const constraints: QueryConstraint[] = [where('status', '==', 'active')];

  const normalizedPos = typeof pos === 'string' ? pos.toUpperCase() : undefined;

  if (normalizedPos && normalizedPos !== 'ALL') {
    constraints.push(where('pos', '==', normalizedPos));
  }

  if (isFiniteNumber(maxPrice) && maxPrice >= 0) {
    const resolvedMaxPrice = Math.max(0, maxPrice);
    constraints.push(where('price', '<=', resolvedMaxPrice));
    constraints.push(orderBy('price', 'asc'));

    if (sort === 'overall_desc') {
      constraints.push(orderBy('overall', 'desc'));
    } else if (sort === 'overall_asc') {
      constraints.push(orderBy('overall', 'asc'));
    } else {
      constraints.push(orderBy('createdAt', 'desc'));
    }
  } else {
    if (sort === 'price_asc') {
      constraints.push(orderBy('price', 'asc'));
    } else if (sort === 'price_desc') {
      constraints.push(orderBy('price', 'desc'));
    } else if (sort === 'overall_asc') {
      constraints.push(orderBy('overall', 'asc'));
    } else if (sort === 'overall_desc') {
      constraints.push(orderBy('overall', 'desc'));
    } else {
      switch (sort) {
        case 'pos_asc':
          constraints.push(orderBy('pos', 'asc'));
          break;
        case 'pos_desc':
          constraints.push(orderBy('pos', 'desc'));
          break;
        case 'seller_asc':
          constraints.push(orderBy('sellerTeamName', 'asc'));
          break;
        case 'seller_desc':
          constraints.push(orderBy('sellerTeamName', 'desc'));
          break;
        case 'name_asc':
          constraints.push(orderBy('playerName', 'asc'));
          break;
        case 'name_desc':
          constraints.push(orderBy('playerName', 'desc'));
          break;
        default:
          constraints.push(orderBy('createdAt', 'desc'));
          break;
      }
    }
  }

  constraints.push(limit(resolveTake(take)));

  return query(collection(db, LISTINGS_PATH), ...constraints);
}

// Used path for listings: transferListings
// Added callables: marketCreateListing, marketCancelListing
// Updated marketplace UI/services.
// Rules block added.
// Indexes added.

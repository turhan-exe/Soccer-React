import type { Firestore } from 'firebase/firestore';
import {
  collection,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import type { Position } from '@/types';

export const LISTINGS_PATH = 'transferListings';

export type MarketSortOption =
  | 'overall_desc'
  | 'overall_asc'
  | 'price_asc'
  | 'price_desc'
  | 'newest';

export interface MarketQueryOptions {
  pos?: Position | 'ALL';
  maxPrice?: number;
  sort?: MarketSortOption;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function queryActiveListings(
  db: Firestore,
  options: MarketQueryOptions = {},
) {
  const { pos, maxPrice, sort = 'overall_desc' } = options;
  const constraints: QueryConstraint[] = [where('status', '==', 'active')];

  if (pos && pos !== 'ALL') {
    constraints.push(where('pos', '==', pos));
  }

  const hasPriceFilter = isFiniteNumber(maxPrice) && maxPrice! > 0;
  if (hasPriceFilter) {
    constraints.push(where('price', '<=', Number(maxPrice)));
  }

  if (hasPriceFilter) {
    constraints.push(orderBy('price', 'asc'));
    if (sort === 'overall_desc') {
      constraints.push(orderBy('overall', 'desc'));
      constraints.push(orderBy('createdAt', 'desc'));
    } else if (sort === 'overall_asc') {
      constraints.push(orderBy('overall', 'asc'));
      constraints.push(orderBy('createdAt', 'desc'));
    } else if (sort === 'price_desc') {
      constraints.push(orderBy('createdAt', 'desc'));
    } else {
      constraints.push(orderBy('createdAt', 'desc'));
    }
  } else {
    switch (sort) {
      case 'overall_asc':
        constraints.push(orderBy('overall', 'asc'));
        constraints.push(orderBy('createdAt', 'desc'));
        break;
      case 'price_asc':
        constraints.push(orderBy('price', 'asc'));
        constraints.push(orderBy('createdAt', 'desc'));
        break;
      case 'price_desc':
        constraints.push(orderBy('price', 'desc'));
        constraints.push(orderBy('createdAt', 'desc'));
        break;
      case 'newest':
        constraints.push(orderBy('createdAt', 'desc'));
        break;
      case 'overall_desc':
      default:
        constraints.push(orderBy('overall', 'desc'));
        constraints.push(orderBy('createdAt', 'desc'));
        break;
    }
  }

  return query(collection(db, LISTINGS_PATH), ...constraints);
}

// Used path for listings: transferListings
// Added callables: marketCreateListing, marketCancelListing
// Updated marketplace UI/services.
// Rules block added.
// Indexes added.

import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type QueryDocumentSnapshot,
  type DocumentData,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from './firebase';
import { Player, TransferListing } from '@/types';
import {
  LISTINGS_PATH,
  queryActiveListings,
  type MarketQueryOptions,
  type MarketSortOption,
} from './market';
export type { MarketSortOption } from './market';

const listingsCollection = collection(db, LISTINGS_PATH);

type TransferListingDoc = Omit<TransferListing, 'id'> & {
  pos?: TransferListing['pos'];
  overall?: number;
};

const sanitizePrice = (price: number) => {
  if (!Number.isFinite(price)) {
    return 0;
  }
  return Math.max(0, Math.round(price));
};

export async function createTransferListing(params: {
  player: Player;
  price: number;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error('Giriş bilgisi bulunamadı.');
  }

  const sellerId = currentUser.uid;
  const { player, price } = params;
  const normalizedPrice = sanitizePrice(price);
  if (!player?.id) {
    throw new Error('Oyuncu bilgisi eksik.');
  }
  if (normalizedPrice <= 0) {
    throw new Error('Fiyat sıfırdan büyük olmalı.');
  }

  const playerId = String(player.id);
  const playerPath = `teams/${sellerId}/players/${playerId}`;

  const fn = httpsCallable<
    { teamId: string; playerId: string; playerPath: string; price: number },
    { ok?: boolean; listingId?: string; message?: string }
  >(functions, 'marketCreateListing');

  try {
    const { data } = await fn({
      teamId: sellerId,
      playerId,
      playerPath,
      price: normalizedPrice,
      pos: player.position,
      overall: player.overall,
    });
    if (!data || data.ok !== true) {
      const message = (data && 'message' in data && typeof data.message === 'string')
        ? data.message
        : 'İlan oluşturulamadı.';
      throw new Error(message);
    }
  } catch (error) {
    const firebaseError = error as { message?: string; code?: string } | undefined;
    if (firebaseError && typeof firebaseError.code === 'string') {
      throw new Error(firebaseError.message || 'İlan oluşturulamadı.');
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('İlan oluşturulamadı.');
  }
}

const toTransferListing = (
  docSnap: QueryDocumentSnapshot<DocumentData>,
): TransferListing => {
  const data = docSnap.data() as TransferListingDoc;
  const status = data.status === 'available' ? 'active' : data.status;
  const sellerUid = data.sellerUid ?? data.sellerId ?? '';
  const sellerId = data.sellerId ?? data.sellerUid ?? '';
  const teamId = data.teamId ?? sellerId ?? sellerUid;
  const player = (data.player ?? {}) as Player;

  return {
    id: docSnap.id,
    ...data,
    status,
    sellerUid,
    sellerId,
    teamId,
    price: Number(data.price ?? 0),
    pos: data.pos ?? data.position ?? player?.position,
    overall: data.overall ?? player?.overall,
    player,
  };
};

export interface ListenListingsOptions extends Omit<MarketQueryOptions, 'sort'> {
  sort?: MarketSortOption;
}

export function listenAvailableTransferListings(
  options: ListenListingsOptions = {},
  cb: (list: TransferListing[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const queryOptions: MarketQueryOptions = {
    pos: options.pos,
    maxPrice: options.maxPrice,
    sort: options.sort,
  };

  const q = queryActiveListings(db, queryOptions);
  return onSnapshot(q, {
    next: snapshot => {
      const list = snapshot.docs.map(toTransferListing);
      cb(list);
    },
    error: err => {
      console.error('[transferListings] onSnapshot error:', err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  });
}

export function listenUserTransferListings(
  uid: string,
  cb: (list: TransferListing[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(
    listingsCollection,
    where('sellerUid', '==', uid),
    where('status', '==', 'active'),
    orderBy('createdAt', 'desc'),
  );

  return onSnapshot(q, {
    next: snapshot => {
      const list = snapshot.docs.map(toTransferListing);
      cb(list);
    },
    error: err => {
      console.error('[transferListings] seller onSnapshot error:', err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  });
}

export async function purchaseTransferListing(params: {
  listingId: string;
  buyerTeamName: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error('Giriş bilgisi bulunamadı.');
  }

  const { listingId, buyerTeamName } = params;

  const fn = httpsCallable<
    { listingId: string; buyerTeamName: string },
    { ok?: boolean; message?: string }
  >(functions, 'marketPurchaseListing');

  try {
    const { data } = await fn({ listingId, buyerTeamName });
    if (!data || data.ok !== true) {
      const message = (data && 'message' in data && typeof data.message === 'string')
        ? data.message
        : 'Satın alma başarısız.';
      throw new Error(message);
    }
  } catch (error) {
    const firebaseError = error as { message?: string; code?: string } | undefined;
    if (firebaseError && typeof firebaseError.code === 'string') {
      throw new Error(firebaseError.message || 'Satın alma başarısız.');
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Satın alma başarısız.');
  }
}

export async function cancelTransferListing(listingId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error('Giriş bilgisi bulunamadı.');
  }

  const fn = httpsCallable<{ listingId: string }, { ok?: boolean; message?: string }>(
    functions,
    'marketCancelListing',
  );

  try {
    const { data } = await fn({ listingId });
    if (!data || data.ok !== true) {
      const message = (data && 'message' in data && typeof data.message === 'string')
        ? data.message
        : 'İlan iptal edilemedi.';
      throw new Error(message);
    }
  } catch (error) {
    const firebaseError = error as { message?: string; code?: string } | undefined;
    if (firebaseError && typeof firebaseError.code === 'string') {
      throw new Error(firebaseError.message || 'İlan iptal edilemedi.');
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('İlan iptal edilemedi.');
  }
}
// Used path for listings: transferListings
// Added callables: marketCreateListing, marketCancelListing
// Updated marketplace UI/services.
// Rules block added.
// Indexes added.

import {
  onSnapshot,
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
  buildTransferListingsQuery,
  type SortKey,
} from './market';
export type MarketSortOption = SortKey;

type TransferListingDoc = Omit<TransferListing, 'id'> & {
  pos?: TransferListing['pos'];
  overall?: number;
};

const sanitizePrice = (price: unknown) => {
  const numeric = Number(price);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.round(numeric));
};

export async function createTransferListing(params: {
  player: Player;
  price: number | string;
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

export interface ListenListingsOptions {
  pos?: TransferListing['pos'] | 'ALL';
  maxPrice?: number;
  sort?: MarketSortOption;
  take?: number;
}

export function listenAvailableTransferListings(
  options: ListenListingsOptions = {},
  cb: (list: TransferListing[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = buildTransferListingsQuery(db, {
    pos: options.pos,
    maxPrice: options.maxPrice,
    sort: options.sort,
    take: options.take,
  });
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
  const baseQuery = buildTransferListingsQuery(db, { sort: 'newest' });
  const q = query(baseQuery, where('sellerUid', '==', uid));

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

export async function purchaseTransferListing(listingId: string, buyerTeamId: string) {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error('Giriş bilgisi bulunamadı.');
  }

  if (!buyerTeamId) {
    throw new Error('Satın alma için takım bilgisi gerekli.');
  }

  const fn = httpsCallable<
    { listingId: string; buyerTeamId: string; purchaseId: string },
    { ok?: boolean; listingId?: string; soldAt?: string }
  >(functions, 'marketPurchaseListing');

  try {
    const payload = {
      listingId,
      buyerTeamId,
      purchaseId:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
    const { data } = await fn(payload);
    if (!data || data.ok !== true) {
      throw new Error('Satın alma başarısız.');
    }
    return data;
  } catch (error) {
    const err = error as { code?: string; message?: string; details?: string } | undefined;
    const code = err?.code || err?.details || 'internal';
    const map: Record<string, string> = {
      'resource-exhausted': 'Bütçe yetersiz.',
      'failed-precondition': 'İlan artık satın alınamaz (satıldı veya kullanım dışı).',
      'permission-denied': 'Bu takımla işlem yapma yetkin yok.',
      'not-found': 'İlan veya oyuncu bulunamadı.',
      'unauthenticated': 'Giriş yapmalısın.',
      internal: 'Sunucu hatası. Lütfen tekrar deneyin.',
    };
    throw new Error(map[code] || err?.message || 'Satın alma başarısız.');
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

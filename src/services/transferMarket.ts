import {
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  type QueryDocumentSnapshot,
  type DocumentData,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from './firebase';
import { Player, TransferListing, type ClubTeam } from '@/types';
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

async function purchaseTransferListingClient(params: {
  listingId: string;
  buyerUid: string;
  buyerTeamName: string;
}): Promise<void> {
  const { listingId, buyerUid, buyerTeamName } = params;
  const listingRef = doc(db, LISTINGS_PATH, listingId);
  const buyerTeamRef = doc(db, 'teams', buyerUid);

  await runTransaction(db, async transaction => {
    const listingSnap = await transaction.get(listingRef);
    if (!listingSnap.exists()) {
      throw new Error('İlan bulunamadı.');
    }

    const listingData = listingSnap.data() as TransferListingDoc;
    const status = listingData.status ?? 'active';
    if (status !== 'active' && status !== 'available') {
      throw new Error('İlan satışta değil.');
    }

    const playerData = (listingData.player ?? null) as Player | null;
    const playerId = String(listingData.playerId ?? playerData?.id ?? '');
    if (!playerData || !playerId) {
      throw new Error('Oyuncu bilgisi eksik.');
    }

    const price = Number(listingData.price ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('İlan fiyatı geçersiz.');
    }

    const buyerSnap = await transaction.get(buyerTeamRef);
    if (!buyerSnap.exists()) {
      throw new Error('Takım bilgisi bulunamadı.');
    }

    const buyerData = buyerSnap.data() as ClubTeam & { players?: Player[] };
    const buyerBudget = Number.isFinite(buyerData?.budget) ? Number(buyerData?.budget) : 0;
    if (buyerBudget < price) {
      throw new Error('Bütçe yetersiz.');
    }

    const buyerPlayers = Array.isArray(buyerData?.players) ? [...(buyerData.players ?? [])] : [];
    const hasPlayer = buyerPlayers.some(existing => existing.id === playerId);
    const normalizedPlayer: Player = {
      ...playerData,
      id: playerId,
      squadRole: playerData.squadRole ?? 'reserve',
      market: { active: false, listingId: null },
    };
    const updatedBuyerPlayers = hasPlayer ? buyerPlayers : [...buyerPlayers, normalizedPlayer];

    transaction.update(buyerTeamRef, {
      players: updatedBuyerPlayers,
      budget: buyerBudget - price,
    });

    transaction.update(listingRef, {
      status: 'sold',
      buyerUid,
      buyerId: buyerUid,
      buyerTeamName,
      soldAt: serverTimestamp(),
      playerId,
    });

    const sellerTeamId = listingData.teamId ?? listingData.sellerId ?? listingData.sellerUid;
    if (sellerTeamId && sellerTeamId !== buyerUid) {
      const sellerRef = doc(db, 'teams', sellerTeamId);
      const sellerSnap = await transaction.get(sellerRef);
      if (sellerSnap.exists()) {
        const sellerData = sellerSnap.data() as ClubTeam & { players?: Player[] };
        const sellerBudget = Number.isFinite(sellerData?.budget) ? Number(sellerData?.budget) : 0;
        const sellerPlayers = Array.isArray(sellerData?.players)
          ? sellerData.players.filter(existing => existing.id !== playerId)
          : [];

        transaction.update(sellerRef, {
          budget: sellerBudget + price,
          players: sellerPlayers,
        });
      }
    }
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
  const buyerUid = currentUser.uid;

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
    const shouldFallback = firebaseError
      ? firebaseError.code === 'functions/unimplemented' ||
        firebaseError.code === 'functions/unavailable' ||
        firebaseError.code === 'functions/not-found'
      : true;

    if (shouldFallback) {
      await purchaseTransferListingClient({ listingId, buyerUid, buyerTeamName });
      return;
    }

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

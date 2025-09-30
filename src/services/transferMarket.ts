import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from './firebase';
import { Player, TransferListing } from '@/types';

const COLLECTION_PATH = 'transferListings';

const listingsCollection = collection(db, COLLECTION_PATH);

type TransferListingDoc = Omit<TransferListing, 'id'>;

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

export function listenAvailableTransferListings(
  cb: (list: TransferListing[]) => void,
): Unsubscribe {
  const q = query(listingsCollection, where('status', '==', 'active'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, snapshot => {
    const list: TransferListing[] = snapshot.docs.map(docSnap => {
      const data = docSnap.data() as TransferListingDoc;
      const status = data.status === 'available' ? 'active' : data.status;
      return {
        id: docSnap.id,
        ...data,
        status,
        sellerUid: data.sellerUid ?? data.sellerId,
        sellerId: data.sellerId ?? data.sellerUid ?? '',
        teamId: data.teamId ?? data.sellerId ?? data.sellerUid,
      };
    });
    cb(list);
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

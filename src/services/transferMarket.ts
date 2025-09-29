import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { ClubTeam, Player, TransferListing } from '@/types';

const COLLECTION_PATH = 'transferListings';

const listingsCollection = collection(db, COLLECTION_PATH);

type TransferListingDoc = Omit<TransferListing, 'id' | 'createdAt' | 'soldAt'> & {
  createdAt?: TransferListing['createdAt'] | ReturnType<typeof serverTimestamp>;
  soldAt?: TransferListing['soldAt'] | ReturnType<typeof serverTimestamp>;
};

type TeamDoc = Pick<ClubTeam, 'players' | 'name'>;

const sanitizePrice = (price: number) => {
  if (!Number.isFinite(price)) {
    return 0;
  }
  return Math.max(0, Math.round(price));
};

export async function createTransferListing(params: {
  sellerTeamName: string;
  player: Player;
  price: number;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error('Giriş bilgisi bulunamadı.');
  }

  const sellerId = currentUser.uid;
  const { sellerTeamName, player, price } = params;
  const normalizedPrice = sanitizePrice(price);
  if (!player?.id) {
    throw new Error('Oyuncu bilgisi eksik.');
  }
  if (normalizedPrice <= 0) {
    throw new Error('Fiyat sıfırdan büyük olmalı.');
  }

  const existingSnap = await getDocs(
    query(
      listingsCollection,
      where('sellerId', '==', sellerId),
      where('playerId', '==', player.id),
      where('status', '==', 'available'),
    ),
  );

  if (!existingSnap.empty) {
    throw new Error('Bu oyuncu zaten pazarda.');
  }

  const payload: TransferListingDoc = {
    playerId: player.id,
    player,
    price: normalizedPrice,
    sellerId,
    sellerTeamName,
    status: 'available',
    createdAt: serverTimestamp(),
  };

  await addDoc(listingsCollection, payload);
}

export function listenAvailableTransferListings(
  cb: (list: TransferListing[]) => void,
): Unsubscribe {
  const q = query(listingsCollection, where('status', '==', 'available'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, snapshot => {
    const list: TransferListing[] = snapshot.docs.map(docSnap => {
      const data = docSnap.data() as TransferListingDoc;
      return {
        id: docSnap.id,
        ...data,
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

  const buyerId = currentUser.uid;
  const { listingId, buyerTeamName } = params;
  const listingRef = doc(db, COLLECTION_PATH, listingId);

  await runTransaction(db, async tx => {
    const listingSnap = await tx.get(listingRef);
    if (!listingSnap.exists()) {
      throw new Error('İlan bulunamadı.');
    }

    const listing = listingSnap.data() as TransferListingDoc;
    if (listing.status !== 'available') {
      throw new Error('İlan satışta değil.');
    }

    if (listing.sellerId === buyerId) {
      throw new Error('Kendi oyuncunu satın alamazsın.');
    }

    const sellerRef = doc(db, 'teams', listing.sellerId);
    const buyerRef = doc(db, 'teams', buyerId);

    const [sellerSnap, buyerSnap] = await Promise.all([tx.get(sellerRef), tx.get(buyerRef)]);

    if (!sellerSnap.exists()) {
      throw new Error('Satıcı takım kaydı bulunamadı.');
    }

    if (!buyerSnap.exists()) {
      throw new Error('Alıcı takım kaydı bulunamadı.');
    }

    const sellerData = sellerSnap.data() as TeamDoc | undefined;
    const buyerData = buyerSnap.data() as TeamDoc | undefined;

    const sellerPlayers = [...(sellerData?.players ?? [])];
    const playerIndex = sellerPlayers.findIndex(p => String(p.id) === String(listing.playerId));

    if (playerIndex === -1) {
      throw new Error('Oyuncu satıcının kadrosunda bulunamadı.');
    }

    const [player] = sellerPlayers.splice(playerIndex, 1);
    const transferredPlayer: Player = {
      ...player,
      squadRole: 'reserve',
    };

    const buyerPlayers = [...(buyerData?.players ?? []), transferredPlayer];

    tx.update(sellerRef, { players: sellerPlayers });
    tx.update(buyerRef, { players: buyerPlayers });
    tx.update(listingRef, {
      status: 'sold',
      buyerId,
      buyerTeamName,
      soldAt: serverTimestamp(),
    });
  });
}

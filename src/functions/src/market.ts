import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import {
  getFirestore,
  FieldValue,
  DocumentReference,
  DocumentData,
} from 'firebase-admin/firestore';

const db = getFirestore();
const LISTINGS_COLLECTION = 'transferListings';

const region = 'europe-west1';

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const assertAuth: (uid: string | undefined) => asserts uid is string = uid => {
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Giriş yapmalısın.');
  }
};

const normalizePrice = (price: unknown): number => {
  if (typeof price !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'Geçerli bir fiyat belirt.');
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Fiyat sıfırdan büyük olmalı.');
  }
  return Math.round(price);
};

type PlayerSnapshot = Record<string, unknown> & {
  id?: string;
  name?: string;
  position?: string;
  overall?: number;
  ownerUid?: string;
  teamId?: string;
  market?: { active?: boolean; listingId?: string | null } | null;
};

const sanitizePlayerForListing = (player: PlayerSnapshot, fallbackId: string) => {
  const playerId = String(player.id ?? fallbackId);
  return {
    ...player,
    id: playerId,
  };
};

type ListingDoc = {
  sellerUid: string;
  sellerId: string;
  teamId: string;
  playerId: string;
  playerPath: string;
  price: number;
  player: PlayerSnapshot;
  playerName?: string;
  position?: string;
  overall?: number;
  sellerTeamName?: string;
  status: 'active' | 'sold' | 'cancelled';
  buyerUid?: string;
  buyerId?: string;
  buyerTeamName?: string;
};

type TeamDoc = {
  ownerUid?: string;
  name?: string;
  players?: PlayerSnapshot[];
};

const listingsCollection = db.collection(LISTINGS_COLLECTION);

export const marketCreateListing = functions
  .region(region)
  .https.onCall(async (rawData, context) => {
    const uid = context.auth?.uid;
    assertAuth(uid);

    const data = rawData ?? {};
    const teamId = isString(data.teamId) ? data.teamId.trim() : '';
    const playerId = isString(data.playerId) ? data.playerId.trim() : '';
    const playerPath = isString(data.playerPath) ? data.playerPath.trim() : '';
    const price = normalizePrice(data.price);

    if (!teamId || !playerId || !playerPath) {
      throw new functions.https.HttpsError('invalid-argument', 'Takım ve oyuncu bilgileri eksik.');
    }

    const listingRef = listingsCollection.doc();
    const listingId = listingRef.id;

    return db.runTransaction(async tx => {
      const teamRef = db.collection('teams').doc(teamId);
      const teamSnap = await tx.get(teamRef);
      if (!teamSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Takım kaydı bulunamadı.');
      }
      const teamData = teamSnap.data() as TeamDoc;
      const ownerUid = teamData.ownerUid ?? teamId;
      if (ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Bu takıma erişimin yok.');
      }

      let playerDocRef: DocumentReference<DocumentData> | null = db.doc(playerPath);
      let playerDocSnap = await tx.get(playerDocRef).catch(() => null);
      let playerData: PlayerSnapshot | null = null;
      let teamPlayers: PlayerSnapshot[] | undefined;
      let playerIndex = -1;

      if (playerDocSnap?.exists) {
        playerData = playerDocSnap.data() as PlayerSnapshot;
        const ownerFromPlayer = playerData.ownerUid ?? playerData.teamId ?? ownerUid;
        if (ownerFromPlayer !== uid) {
          throw new functions.https.HttpsError('permission-denied', 'Bu oyuncu sana ait değil.');
        }
        if (playerData.market?.active) {
          throw new functions.https.HttpsError('failed-precondition', 'Oyuncu zaten pazarda.');
        }
      } else {
        // Fallback: player stored within team doc array
        teamPlayers = Array.isArray(teamData.players) ? [...teamData.players] : [];
        playerIndex = teamPlayers.findIndex(p => String(p.id) === playerId);
        if (playerIndex === -1) {
          throw new functions.https.HttpsError('not-found', 'Oyuncu kadroda bulunamadı.');
        }
        playerData = teamPlayers[playerIndex];
        if (playerData.market?.active) {
          throw new functions.https.HttpsError('failed-precondition', 'Oyuncu zaten pazarda.');
        }
        playerDocRef = null;
        playerDocSnap = null;
      }

      const duplicateSnap = await tx.get(
        listingsCollection
          .where('playerId', '==', playerId)
          .where('status', '==', 'active')
          .limit(1),
      );
      if (!duplicateSnap.empty) {
        throw new functions.https.HttpsError('failed-precondition', 'Bu oyuncu zaten pazarda.');
      }

      const sanitizedPlayer = sanitizePlayerForListing(playerData!, playerId);
      const sellerTeamName = teamData.name ?? 'Takımım';

      const payload: ListingDoc = {
        sellerUid: uid,
        sellerId: uid,
        teamId,
        playerId,
        playerPath,
        price,
        player: sanitizedPlayer,
        playerName: sanitizedPlayer.name,
        position: sanitizedPlayer.position,
        overall: sanitizedPlayer.overall,
        sellerTeamName,
        status: 'active',
      };

      tx.set(listingRef, {
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (playerDocRef) {
        tx.update(playerDocRef, {
          market: { active: true, listingId },
        });
      } else if (teamPlayers && playerIndex > -1) {
        const updatedPlayer = {
          ...teamPlayers[playerIndex],
          market: { active: true, listingId },
        } as PlayerSnapshot;
        teamPlayers[playerIndex] = updatedPlayer;
        tx.update(teamRef, { players: teamPlayers });
      }

      return { ok: true, listingId };
    });
  });

export const marketCancelListing = functions
  .region(region)
  .https.onCall(async (rawData, context) => {
    const uid = context.auth?.uid;
    assertAuth(uid);

    const data = rawData ?? {};
    const listingId = isString(data.listingId) ? data.listingId.trim() : '';
    if (!listingId) {
      throw new functions.https.HttpsError('invalid-argument', 'İlan bilgisi eksik.');
    }

    const listingRef = listingsCollection.doc(listingId);

    await db.runTransaction(async tx => {
      const listingSnap = await tx.get(listingRef);
      if (!listingSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'İlan bulunamadı.');
      }
      const listing = listingSnap.data() as ListingDoc;
      if (listing.sellerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Bu ilan sana ait değil.');
      }
      if (listing.status !== 'active') {
        throw new functions.https.HttpsError('failed-precondition', 'İlan aktif değil.');
      }

      const playerPath = listing.playerPath;
      let resetViaTeamDoc = false;
      if (playerPath) {
        const playerRef = db.doc(playerPath);
        const playerSnap = await tx.get(playerRef).catch(() => null);
        if (playerSnap?.exists) {
          tx.update(playerRef, {
            market: { active: false, listingId: null },
          });
        } else {
          resetViaTeamDoc = true;
        }
      } else {
        resetViaTeamDoc = true;
      }

      if (resetViaTeamDoc) {
        const teamRef = db.collection('teams').doc(listing.teamId);
        const teamSnap = await tx.get(teamRef);
        if (teamSnap.exists) {
          const teamData = teamSnap.data() as TeamDoc;
          const players = Array.isArray(teamData.players) ? [...teamData.players] : [];
          const index = players.findIndex(p => String(p.id) === listing.playerId);
          if (index > -1) {
            const updatedPlayer = {
              ...players[index],
              market: { active: false, listingId: null },
            } as PlayerSnapshot;
            players[index] = updatedPlayer;
            tx.update(teamRef, { players });
          }
        }
      }

      tx.update(listingRef, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  });

export const marketPurchaseListing = functions
  .region(region)
  .https.onCall(async (rawData, context) => {
    const uid = context.auth?.uid;
    assertAuth(uid);

    const data = rawData ?? {};
    const listingId = isString(data.listingId) ? data.listingId.trim() : '';
    const buyerTeamName = isString(data.buyerTeamName) ? data.buyerTeamName.trim() : '';

    if (!listingId) {
      throw new functions.https.HttpsError('invalid-argument', 'İlan bilgisi eksik.');
    }

    const listingRef = listingsCollection.doc(listingId);

    await db.runTransaction(async tx => {
      const listingSnap = await tx.get(listingRef);
      if (!listingSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'İlan bulunamadı.');
      }
      const listing = listingSnap.data() as ListingDoc;
      if (listing.status !== 'active') {
        throw new functions.https.HttpsError('failed-precondition', 'İlan aktif değil.');
      }
      if (listing.sellerUid === uid) {
        throw new functions.https.HttpsError('failed-precondition', 'Kendi oyuncunu satın alamazsın.');
      }

      const sellerTeamId = listing.teamId ?? listing.sellerUid;
      const sellerRef = db.collection('teams').doc(sellerTeamId);
      const buyerRef = db.collection('teams').doc(uid);

      const [sellerSnap, buyerSnap] = await Promise.all([tx.get(sellerRef), tx.get(buyerRef)]);
      if (!sellerSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Satıcı takım bulunamadı.');
      }
      if (!buyerSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Alıcı takım bulunamadı.');
      }

      const sellerData = sellerSnap.data() as TeamDoc;
      const buyerData = buyerSnap.data() as TeamDoc;

      const sellerPlayers = Array.isArray(sellerData.players) ? [...sellerData.players] : [];
      const playerIndex = sellerPlayers.findIndex(p => String(p.id) === listing.playerId);
      let transferredPlayer: PlayerSnapshot | null = null;

      if (playerIndex > -1) {
        const [player] = sellerPlayers.splice(playerIndex, 1);
        transferredPlayer = {
          ...player,
          market: { active: false, listingId: null },
          squadRole: 'reserve',
        };
      } else if (listing.playerPath) {
        const playerDocRef = db.doc(listing.playerPath);
        const playerDocSnap = await tx.get(playerDocRef).catch(() => null);
        if (playerDocSnap?.exists) {
          const player = playerDocSnap.data() as PlayerSnapshot;
          transferredPlayer = {
            ...player,
            market: { active: false, listingId: null },
            squadRole: 'reserve',
          };
        }
      }

      if (!transferredPlayer) {
        throw new functions.https.HttpsError('failed-precondition', 'Oyuncu satıcı takımda bulunamadı.');
      }

      const buyerPlayers = Array.isArray(buyerData.players) ? [...buyerData.players] : [];
      buyerPlayers.push(transferredPlayer);

      if (playerIndex > -1) {
        tx.update(sellerRef, { players: sellerPlayers });
      }
      tx.update(buyerRef, { players: buyerPlayers });

      tx.update(listingRef, {
        status: 'sold',
        buyerUid: uid,
        buyerId: uid,
        buyerTeamName: buyerTeamName || buyerData.name || 'Takımım',
        soldAt: FieldValue.serverTimestamp(),
      });

      if (listing.playerPath) {
        const playerDocRef = db.doc(listing.playerPath);
        const playerDocSnap = await tx.get(playerDocRef).catch(() => null);
        if (playerDocSnap?.exists) {
          tx.update(playerDocRef, {
            ownerUid: uid,
            teamId: uid,
            market: { active: false, listingId: null },
          });
        }
      }
    });

    return { ok: true };
  });

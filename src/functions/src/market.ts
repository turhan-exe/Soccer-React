import * as functions from 'firebase-functions/v1';
import './_firebase.js';
import {
  getFirestore,
  FieldValue,
  DocumentReference,
  DocumentData,
  Timestamp,
} from 'firebase-admin/firestore';

const db = getFirestore();
const LISTINGS_PATH = 'transferListings';

const region = 'europe-west1';

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const assertAuth: (uid: string | undefined) => asserts uid is string = uid => {
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Giriş yapmalısın.');
  }
};

const normalizePrice = (price: unknown): number => {
  const numeric = Number(price);
  if (!Number.isFinite(numeric)) {
    throw new functions.https.HttpsError('invalid-argument', 'Geçerli bir fiyat belirt.');
  }
  if (numeric <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Fiyat sıfırdan büyük olmalı.');
  }
  return Math.round(numeric);
};

type PlayerSnapshot = Record<string, unknown> & {
  id?: string;
  name?: string;
  position?: string;
  overall?: number;
  age?: number;
  ownerUid?: string;
  teamId?: string;
  squadRole?: string;
  uniqueId?: string;
  market?: {
    active?: boolean;
    listingId?: string | null;
    locked?: boolean;
    lockReason?: string | null;
    autoListedAt?: string | null;
    autoListReason?: string | null;
    autoRelistAfter?: string | null;
  } | null;
  contract?: {
    expiresAt?: string;
    status?: string;
    salary?: number;
    extensions?: number;
  } | null;
};

const isLegendSnapshot = (player: PlayerSnapshot | null | undefined): boolean => {
  if (!player) {
    return false;
  }
  const uniqueId = typeof player.uniqueId === 'string' ? player.uniqueId : '';
  if (/^legend-(\d+)$/.test(uniqueId)) {
    return true;
  }
  const rawId = typeof player.id === 'string' ? player.id : String(player.id ?? '');
  return /^legend-(\d+)-/.test(rawId);
};

const sanitizePlayerForListing = (player: PlayerSnapshot, fallbackId: string) => {
  const playerId = String(player.id ?? fallbackId);
  return {
    ...player,
    id: playerId,
  };
};

const getTransferBudget = (team?: TeamDoc | null): number => {
  if (!team) {
    return 0;
  }
  const candidates = [team.transferBudget, team.budget];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return 0;
};

const collectAuthorizedUids = (team: TeamDoc, fallbackId: string): Set<string> => {
  const allowed = new Set<string>();
  if (fallbackId) {
    allowed.add(String(fallbackId));
  }
  if (team.ownerUid) {
    allowed.add(String(team.ownerUid));
  }
  const candidateLists = [
    team.managers,
    team.managerUids,
    team.admins,
    team.authorizedUids,
  ];
  for (const list of candidateLists) {
    if (!Array.isArray(list)) continue;
    for (const id of list) {
      if (typeof id === 'string' && id.trim()) {
        allowed.add(id.trim());
      } else if (id != null) {
        allowed.add(String(id));
      }
    }
  }
  return allowed;
};

const resolvePlayerTransferTarget = (
  playerPath: string,
  buyerTeamId: string,
  buyerUid: string,
  playerId: string,
): DocumentReference<DocumentData> | null => {
  if (!playerId) {
    return null;
  }
  const segments = playerPath.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  if (segments[0] === 'teams') {
    return db.doc(`teams/${buyerTeamId}/players/${playerId}`);
  }
  if (segments[0] === 'users') {
    return db.doc(`users/${buyerUid}/squad/${playerId}`);
  }
  return null;
};

type ListingDoc = {
  sellerUid: string;
  sellerId: string;
  teamId: string;
  sellerTeamId?: string;
  playerId: string;
  playerPath: string;
  price: number;
  player: PlayerSnapshot;
  playerName?: string;
  position?: string;
  pos?: string;
  overall?: number;
  sellerTeamName?: string;
  status: 'active' | 'sold' | 'cancelled';
  buyerUid?: string;
  buyerId?: string;
  buyerTeamId?: string;
  buyerTeamName?: string;
};

type TeamDoc = {
  ownerUid?: string;
  name?: string;
  players?: PlayerSnapshot[];
  transferBudget?: number;
  budget?: number;
  managers?: string[];
  managerUids?: string[];
  admins?: string[];
  authorizedUids?: string[];
};

const listingsCollection = db.collection(LISTINGS_PATH);

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
    const requestedPos = isString(data.pos) ? data.pos.trim().toUpperCase() : '';
    const requestedOverall =
      typeof data.overall === 'number' && Number.isFinite(data.overall)
        ? Number(data.overall)
        : undefined;

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

      if (playerData?.market?.locked || isLegendSnapshot(playerData)) {
        throw new functions.https.HttpsError('failed-precondition', 'Bu oyuncu transfer pazarına çıkarılamaz.');
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
      const finalPos =
        requestedPos ||
        (sanitizedPlayer.position ? String(sanitizedPlayer.position).toUpperCase() : undefined);
      const finalOverall =
        typeof requestedOverall === 'number'
          ? requestedOverall
          : typeof sanitizedPlayer.overall === 'number'
            ? sanitizedPlayer.overall
            : undefined;

      const payload: ListingDoc = {
        sellerUid: uid,
        sellerId: uid,
        teamId,
        sellerTeamId: teamId,
        playerId,
        playerPath,
        price,
        player: sanitizedPlayer,
        playerName: sanitizedPlayer.name,
        position: sanitizedPlayer.position,
        sellerTeamName,
        status: 'active',
      };

      if (finalPos) {
        payload.pos = finalPos;
      }
      if (typeof finalOverall === 'number') {
        payload.overall = finalOverall;
      }

      tx.set(listingRef, {
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
      });

      const nextMarketState = {
        ...(playerData?.market ?? { active: false, listingId: null }),
        active: true,
        listingId,
      } as PlayerSnapshot['market'];

      if (playerDocRef) {
        tx.update(playerDocRef, {
          market: nextMarketState,
        });
      } else if (teamPlayers && playerIndex > -1) {
        const updatedPlayer = {
          ...teamPlayers[playerIndex],
          market: nextMarketState,
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
          const snapshotData = playerSnap.data() as PlayerSnapshot;
          const marketState = {
            ...(snapshotData.market ?? { active: false, listingId: null }),
            active: false,
            listingId: null,
          } as PlayerSnapshot['market'];
          tx.update(playerRef, {
            market: marketState,
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
              market: {
                ...(players[index].market ?? { active: false, listingId: null }),
                active: false,
                listingId: null,
              },
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
    try {
      const uid = context.auth?.uid;
      assertAuth(uid);

      const data = rawData ?? {};
      const listingId = isString(data.listingId) ? data.listingId.trim() : '';
      const buyerTeamId = isString(data.buyerTeamId) ? data.buyerTeamId.trim() : '';
      const purchaseId = isString(data.purchaseId) ? data.purchaseId.trim() : '';

      if (!listingId || !buyerTeamId) {
        throw new functions.https.HttpsError('invalid-argument', 'MISSING_PARAMS');
      }

      const listingRef = listingsCollection.doc(listingId);
      const buyerTeamRef = db.collection('teams').doc(buyerTeamId);
      const purchaseRef = purchaseId ? db.collection('purchases').doc(purchaseId) : null;

      const { soldAt } = await db.runTransaction(async tx => {
        if (purchaseRef) {
          const purchaseSnap = await tx.get(purchaseRef);
          if (purchaseSnap.exists) {
            const purchaseData = purchaseSnap.data() as {
              listingId?: string;
              soldAt?: unknown;
            };
            if (purchaseData.listingId === listingId) {
              const soldAtValue = purchaseData.soldAt;
              const iso =
                soldAtValue instanceof Timestamp
                  ? soldAtValue.toDate().toISOString()
                  : typeof soldAtValue === 'string'
                    ? soldAtValue
                    : new Date().toISOString();
              return { soldAt: iso };
            }
            throw new functions.https.HttpsError('failed-precondition', 'PURCHASE_CONFLICT');
          }
        }

        const listingSnap = await tx.get(listingRef);
        if (!listingSnap.exists) {
          throw new functions.https.HttpsError('not-found', 'LISTING_NOT_FOUND');
        }
        const listing = listingSnap.data() as ListingDoc;
        if (listing.status !== 'active') {
          throw new functions.https.HttpsError('failed-precondition', 'ALREADY_SOLD');
        }
        if (listing.sellerUid === uid) {
          throw new functions.https.HttpsError('failed-precondition', 'SELF_PURCHASE');
        }

        const buyerTeamSnap = await tx.get(buyerTeamRef);
        if (!buyerTeamSnap.exists) {
          throw new functions.https.HttpsError('permission-denied', 'TEAM_NOT_FOUND');
        }
        const buyerTeam = buyerTeamSnap.data() as TeamDoc;
        const authorizedUids = collectAuthorizedUids(buyerTeam, buyerTeamId);
        if (!authorizedUids.has(uid)) {
          throw new functions.https.HttpsError('permission-denied', 'NOT_TEAM_OWNER');
        }

        const price = Number(listing.price ?? 0);
        if (!Number.isFinite(price) || price <= 0) {
          throw new functions.https.HttpsError('failed-precondition', 'INVALID_PRICE');
        }

        const buyerBudget = getTransferBudget(buyerTeam);
        if (buyerBudget < price) {
          throw new functions.https.HttpsError('resource-exhausted', 'INSUFFICIENT_FUNDS');
        }

        const sellerTeamId = String(listing.sellerTeamId ?? listing.teamId ?? '');
        const sellerTeamRef = sellerTeamId ? db.collection('teams').doc(sellerTeamId) : null;
        const sellerTeamSnap = sellerTeamRef ? await tx.get(sellerTeamRef).catch(() => null) : null;
        const sellerTeam = sellerTeamSnap?.exists ? (sellerTeamSnap.data() as TeamDoc) : null;
        const sellerBudget = getTransferBudget(sellerTeam);

        const playerPath = typeof listing.playerPath === 'string' ? listing.playerPath : '';
        const playerRef = playerPath ? db.doc(playerPath) : null;
        const playerSnap = playerRef ? await tx.get(playerRef).catch(() => null) : null;

        let playerData: PlayerSnapshot | null = null;
        if (playerSnap?.exists) {
          const snapshotData = playerSnap.data() as PlayerSnapshot;
          if (!snapshotData.market?.active || snapshotData.market?.listingId !== listingId) {
            throw new functions.https.HttpsError('failed-precondition', 'PLAYER_NOT_ON_MARKET');
          }
          playerData = snapshotData;
        }

        const sellerPlayers = sellerTeam?.players ? [...sellerTeam.players] : undefined;
        let sellerPlayerIndex = -1;
        if (sellerPlayers) {
          sellerPlayerIndex = sellerPlayers.findIndex(
            candidate => String(candidate.id ?? '') === String(listing.playerId ?? ''),
          );
          if (sellerPlayerIndex > -1) {
            const candidate = sellerPlayers[sellerPlayerIndex];
            if (!candidate.market?.active || candidate.market?.listingId !== listingId) {
              throw new functions.https.HttpsError('failed-precondition', 'PLAYER_NOT_ON_MARKET');
            }
            if (!playerData) {
              playerData = candidate;
            }
          }
        }

        if (!playerData) {
          throw new functions.https.HttpsError('failed-precondition', 'PLAYER_NOT_AVAILABLE');
        }

        const playerId = String(listing.playerId ?? playerData.id ?? '');
        if (!playerId) {
          throw new functions.https.HttpsError('failed-precondition', 'PLAYER_NOT_AVAILABLE');
        }

        const updatedPlayer: PlayerSnapshot = {
          ...playerData,
          id: playerId,
          ownerUid: uid,
          teamId: buyerTeamId,
          squadRole: typeof playerData.squadRole === 'string' ? playerData.squadRole : 'reserve',
          market: { active: false, listingId: null },
        };

        if (sellerPlayers && sellerPlayerIndex > -1) {
          sellerPlayers.splice(sellerPlayerIndex, 1);
        }

        const buyerPlayers = Array.isArray(buyerTeam.players) ? [...buyerTeam.players] : [];
        const buyerPlayerIndex = buyerPlayers.findIndex(p => String(p.id ?? '') === playerId);
        if (buyerPlayerIndex > -1) {
          buyerPlayers[buyerPlayerIndex] = { ...buyerPlayers[buyerPlayerIndex], ...updatedPlayer };
        } else {
          buyerPlayers.push(updatedPlayer);
        }

        const updatedBuyerBudget = Math.max(0, Math.round(buyerBudget - price));
        tx.update(buyerTeamRef, {
          transferBudget: updatedBuyerBudget,
          budget: updatedBuyerBudget,
          players: buyerPlayers,
        });

        if (
          sellerTeamRef &&
          sellerTeamSnap?.exists &&
          sellerTeamRef.path !== buyerTeamRef.path
        ) {
          const updatedSellerBudget = Math.round(sellerBudget + price);
          const sellerUpdates: Record<string, unknown> = {
            transferBudget: updatedSellerBudget,
            budget: updatedSellerBudget,
          };
          if (sellerPlayers) {
            sellerUpdates.players = sellerPlayers;
          }
          tx.update(sellerTeamRef, sellerUpdates);
        }

        let targetPlayerRef: DocumentReference<DocumentData> | null = null;
        if (playerRef && playerSnap?.exists) {
          const resolved = resolvePlayerTransferTarget(playerPath, buyerTeamId, uid, playerId);
          if (resolved && resolved.path !== playerRef.path) {
            targetPlayerRef = resolved;
            tx.set(resolved, updatedPlayer, { merge: true });
            tx.delete(playerRef);
          } else {
            targetPlayerRef = playerRef;
            tx.set(playerRef, updatedPlayer, { merge: true });
          }
        } else if (playerPath) {
          const resolved = resolvePlayerTransferTarget(playerPath, buyerTeamId, uid, playerId);
          if (resolved) {
            targetPlayerRef = resolved;
            tx.set(resolved, updatedPlayer, { merge: true });
          }
        }

        const listingUpdates: Record<string, unknown> = {
          status: 'sold',
          buyerUid: uid,
          buyerId: uid,
          buyerTeamId,
          buyerTeamName: buyerTeam.name ?? 'Takımım',
          soldAt: FieldValue.serverTimestamp(),
          player: {
            ...(listing.player ?? {}),
            ...updatedPlayer,
          },
        };
        if (targetPlayerRef) {
          listingUpdates.playerPath = targetPlayerRef.path;
        }

        tx.update(listingRef, listingUpdates);

        if (purchaseRef) {
          tx.set(purchaseRef, {
            listingId,
            buyerUid: uid,
            buyerTeamId,
            soldAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
          });
        }

        return { soldAt: new Date().toISOString() };
      });

      return { ok: true, listingId, soldAt };
    } catch (error) {
      console.error('marketPurchaseListing error:', error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError('internal', (error as Error)?.message ?? 'INTERNAL');
    }
  });

const LISTING_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const AUTO_RELIST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STALE_CLEANUP = 150;
const MAX_AUTO_LISTINGS_PER_RUN = 120;

const normalizeRatingTo100Value = (value?: number | null): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value <= 1.001) return value * 100;
  if (value <= 10.001) return value * 10;
  return value;
};

const computeAutoListingPrice = (player: PlayerSnapshot): number => {
  const normalizedOverall = normalizeRatingTo100Value(player.overall);
  const salary = typeof player.contract?.salary === 'number' && Number.isFinite(player.contract.salary)
    ? player.contract.salary
    : 0;
  const base = Math.max(25_000, Math.round(normalizedOverall * 1_500));
  const salaryWeight = salary > 0 ? salary * 8 : 0;
  let price = base + salaryWeight;
  if (typeof player.age === 'number') {
    if (player.age < 24) {
      price *= 1.1;
    } else if (player.age > 32) {
      price *= 0.9;
    }
  }
  return Math.max(5_000, Math.round(price));
};

const parseMillis = (value: unknown): number | null => {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const hasExpiredContract = (player: PlayerSnapshot, nowMs: number): boolean => {
  const expiresAtMs = parseMillis(player.contract?.expiresAt ?? null);
  if (expiresAtMs === null) return false;
  return expiresAtMs <= nowMs;
};

const hasRecentAutoListing = (player: PlayerSnapshot, nowMs: number): boolean => {
  const relistAfter = parseMillis(player.market?.autoRelistAfter ?? null);
  if (relistAfter && relistAfter > nowMs) {
    return true;
  }
  const autoListedAt = parseMillis(player.market?.autoListedAt ?? null);
  return autoListedAt !== null && nowMs - autoListedAt < AUTO_RELIST_COOLDOWN_MS;
};

const isEligibleForAutoListing = (
  player: PlayerSnapshot,
  nowMs: number,
  activePlayerIds: Set<string>,
): boolean => {
  const playerId = String(player.id ?? '');
  if (!playerId) return false;
  if (activePlayerIds.has(playerId)) return false;
  if (player.market?.active) return false;
  if (player.market?.locked) return false;
  if (player.contract?.status === 'released') return false;
  if (isLegendSnapshot(player)) return false;
  if (!hasExpiredContract(player, nowMs)) return false;
  if (hasRecentAutoListing(player, nowMs)) return false;
  return true;
};

const resetPlayerMarketState = async (
  tx: FirebaseFirestore.Transaction,
  listing: ListingDoc,
): Promise<void> => {
  const playerId = String(listing.playerId ?? '');
  const playerPath = typeof listing.playerPath === 'string' ? listing.playerPath : '';
  let resetViaTeamDoc = false;

  if (playerPath) {
    try {
      const playerRef = db.doc(playerPath);
      const playerSnap = await tx.get(playerRef).catch(() => null);
      if (playerSnap?.exists) {
        const snapshotData = playerSnap.data() as PlayerSnapshot;
        const marketState = {
          ...(snapshotData.market ?? { active: false, listingId: null }),
          active: false,
          listingId: null,
        } as PlayerSnapshot['market'];
        tx.update(playerRef, { market: marketState });
        return;
      }
      resetViaTeamDoc = true;
    } catch (err) {
      console.warn('[market] resetPlayerMarketState playerPath failed', { playerPath, err });
      resetViaTeamDoc = true;
    }
  } else {
    resetViaTeamDoc = true;
  }

  if (resetViaTeamDoc) {
    const teamId = String(listing.teamId ?? listing.sellerTeamId ?? listing.sellerUid ?? listing.sellerId ?? '');
    if (!teamId) return;
    const teamRef = db.collection('teams').doc(teamId);
    const teamSnap = await tx.get(teamRef).catch(() => null);
    if (!teamSnap?.exists) return;
    const teamData = teamSnap.data() as TeamDoc;
    const players = Array.isArray(teamData.players) ? [...teamData.players] : [];
    const idx = players.findIndex(p => String(p.id ?? '') === playerId);
    if (idx > -1) {
      const updated = {
        ...players[idx],
        market: {
          ...(players[idx].market ?? { active: false, listingId: null }),
          active: false,
          listingId: null,
        },
      } as PlayerSnapshot;
      players[idx] = updated;
      tx.update(teamRef, { players });
    }
  }
};

const createAutoListingForPlayer = async (
  teamRef: FirebaseFirestore.DocumentReference,
  playerId: string,
  activePlayerIds: Set<string>,
  nowMs: number,
): Promise<boolean> => {
  try {
    const ok = await db.runTransaction(async tx => {
      const freshTeamSnap = await tx.get(teamRef);
      if (!freshTeamSnap.exists) return false;
      const team = freshTeamSnap.data() as TeamDoc;
      const roster = Array.isArray(team.players) ? [...team.players] : [];
      const idx = roster.findIndex(p => String(p.id ?? '') === playerId);
      if (idx === -1) return false;
      const player = roster[idx];

      if (!isEligibleForAutoListing(player, nowMs, activePlayerIds)) {
        return false;
      }

      const listingRef = listingsCollection.doc();
      const playerPath = `teams/${teamRef.id}/players/${playerId}`;
      const nowIso = new Date(nowMs).toISOString();
      const relistAfter = new Date(nowMs + AUTO_RELIST_COOLDOWN_MS).toISOString();
      const sanitizedPlayer = sanitizePlayerForListing(player, playerId);

      const listingData: ListingDoc & {
        autoListed: boolean;
        autoListReason: string;
        autoListedAt: string;
        contractExpiredAt?: string | null;
      } = {
        sellerUid: team.ownerUid ?? teamRef.id,
        sellerId: team.ownerUid ?? teamRef.id,
        teamId: teamRef.id,
        sellerTeamId: teamRef.id,
        playerId,
        playerPath,
        price: computeAutoListingPrice(player),
        player: sanitizedPlayer,
        playerName: sanitizedPlayer.name,
        position: sanitizedPlayer.position,
        pos: sanitizedPlayer.position,
        overall: sanitizedPlayer.overall,
        sellerTeamName: team.name ?? 'Tak��m��m',
        status: 'active',
        autoListed: true,
        autoListReason: 'contract_expired',
        autoListedAt: nowIso,
        contractExpiredAt: typeof player.contract?.expiresAt === 'string' ? player.contract.expiresAt : null,
      };

      const updatedMarket: PlayerSnapshot['market'] = {
        ...(player.market ?? { active: false, listingId: null }),
        active: true,
        listingId: listingRef.id,
        autoListedAt: nowIso,
        autoListReason: 'contract_expired',
        autoRelistAfter: relistAfter,
      };

      const updatedContract: NonNullable<PlayerSnapshot['contract']> = {
        ...(player.contract ?? {}),
        status: 'expired',
      };

      const updatedPlayer: PlayerSnapshot = {
        ...player,
        id: playerId,
        market: updatedMarket,
        contract: updatedContract,
      };

      roster[idx] = updatedPlayer;

      tx.set(listingRef, {
        ...listingData,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(teamRef, { players: roster });

      return true;
    });

    if (ok) {
      activePlayerIds.add(playerId);
    }

    return ok;
  } catch (err) {
    console.error('[market] autoListExpiredContracts failed', {
      teamId: teamRef.id,
      playerId,
      err,
    });
    return false;
  }
};

export const expireStaleTransferListings = functions
  .region(region)
  .pubsub.schedule('every 6 hours')
  .timeZone('Europe/Istanbul')
  .onRun(async () => {
    const cutoffMs = Date.now() - LISTING_TTL_MS;
    const cutoff = Timestamp.fromMillis(cutoffMs);

    const snap = await listingsCollection
      .where('status', '==', 'active')
      .where('createdAt', '<=', cutoff)
      .limit(MAX_STALE_CLEANUP)
      .get();

    let expired = 0;
    for (const doc of snap.docs) {
      try {
        await db.runTransaction(async tx => {
          const listingSnap = await tx.get(doc.ref);
          if (!listingSnap.exists) return;
          const listing = listingSnap.data() as ListingDoc & { createdAt?: Timestamp };
          if (listing.status !== 'active') return;
          const createdAtMs = parseMillis(listing.createdAt ?? null);
          if (createdAtMs === null || createdAtMs > cutoffMs) return;

          await resetPlayerMarketState(tx, listing);
          tx.update(doc.ref, {
            status: 'expired',
            expiredAt: FieldValue.serverTimestamp(),
            expiryReason: 'stale_3d',
          });
          expired++;
        });
      } catch (err) {
        console.error('[market] expireStaleTransferListings failed', {
          listingId: doc.id,
          err,
        });
      }
    }

    console.log('[market] expireStaleTransferListings complete', {
      scanned: snap.size,
      expired,
      cutoff: new Date(cutoffMs).toISOString(),
    });

    return undefined;
  });

export const autoListExpiredContracts = functions
  .region(region)
  .pubsub.schedule('30 4 * * *')
  .timeZone('Europe/Istanbul')
  .onRun(async () => {
    const nowMs = Date.now();
    const activePlayerIds = new Set<string>();

    const activeListingsSnap = await listingsCollection
      .where('status', '==', 'active')
      .select('playerId')
      .get();
    activeListingsSnap.docs.forEach(doc => {
      const pid = doc.get('playerId');
      if (pid != null) {
        activePlayerIds.add(String(pid));
      }
    });

    const teamsSnap = await db.collection('teams').select('players', 'ownerUid', 'name').get();
    let created = 0;

    for (const teamDoc of teamsSnap.docs) {
      if (created >= MAX_AUTO_LISTINGS_PER_RUN) break;
      const teamData = teamDoc.data() as TeamDoc;
      const players = Array.isArray(teamData.players) ? teamData.players : [];

      for (const player of players) {
        if (created >= MAX_AUTO_LISTINGS_PER_RUN) break;
        const playerId = String(player?.id ?? '');
        if (!playerId) continue;
        if (!isEligibleForAutoListing(player as PlayerSnapshot, nowMs, activePlayerIds)) continue;

        const listed = await createAutoListingForPlayer(teamDoc.ref, playerId, activePlayerIds, nowMs);
        if (listed) {
          created++;
        }
      }
    }

    console.log('[market] autoListExpiredContracts complete', {
      created,
      scannedTeams: teamsSnap.size,
      activeListingsSeen: activeListingsSnap.size,
    });

    return { created, scannedTeams: teamsSnap.size };
  });

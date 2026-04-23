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
const FINANCE_DEFAULT_BALANCE = 50_000;

const region = 'europe-west1';
const TZ = 'Europe/Istanbul';
const SYSTEM_MARKET_SELLER_ID = 'system-market';
const SYSTEM_MARKET_SELLER_NAME = 'Transfer Pazari';
export const TRANSFER_MARKET_TARGET_ACTIVE_LISTINGS = 100;
export const MAX_SYSTEM_MARKET_TOP_UP_PER_RUN = 100;
const TOP_UP_TRANSFER_MARKET_CRON = '1 0 * * *';
export const TRANSFER_LISTING_TTL_DAYS = 14;
export const TRANSFER_LISTING_TTL_MS = TRANSFER_LISTING_TTL_DAYS * 24 * 60 * 60 * 1000;
const ADMIN_SECRETS = Array.from(
  new Set(
    [
      process.env.ADMIN_SECRET || '',
      (functions.config() as any)?.admin?.secret || '',
      (functions.config() as any)?.scheduler?.secret || '',
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ),
);

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

export const getTransferListingExpiresAtIso = (createdAtMs: number): string =>
  new Date(createdAtMs + TRANSFER_LISTING_TTL_MS).toISOString();

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
  status: 'active' | 'sold' | 'cancelled' | 'expired';
  expiresAt?: string;
  buyerUid?: string;
  buyerId?: string;
  buyerTeamId?: string;
  buyerTeamName?: string;
  systemGenerated?: boolean;
  autoListed?: boolean;
  autoListReason?: string;
  autoListedAt?: string;
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
const financeDoc = (uid: string) => db.collection('finance').doc(uid);
const financeHistoryCollection = (uid: string) => db.collection('finance').doc('history').collection(uid);

const resolveTeamFinanceBalance = (
  team?: TeamDoc | null,
  finance?: { balance?: number } | null,
) => {
  if (typeof team?.transferBudget === 'number' && Number.isFinite(team.transferBudget)) {
    return Math.max(0, Math.round(team.transferBudget));
  }
  if (typeof team?.budget === 'number' && Number.isFinite(team.budget)) {
    return Math.max(0, Math.round(team.budget));
  }
  if (typeof finance?.balance === 'number' && Number.isFinite(finance.balance)) {
    return Math.max(0, Math.round(finance.balance));
  }
  return FINANCE_DEFAULT_BALANCE;
};

const setFinanceMirror = (
  tx: FirebaseFirestore.Transaction,
  teamId: string,
  balance: number,
) => {
  tx.set(
    financeDoc(teamId),
    {
      balance: Math.max(0, Math.round(balance)),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
};

const addFinanceHistoryEntry = (
  tx: FirebaseFirestore.Transaction,
  teamId: string,
  entry: {
    type: 'income' | 'expense';
    category: 'transfer';
    amount: number;
    source?: string;
    note?: string;
  },
) => {
  const ref = financeHistoryCollection(teamId).doc();
  tx.set(ref, {
    id: ref.id,
    type: entry.type,
    category: entry.category,
    amount: Math.max(0, Math.round(entry.amount)),
    source: entry.source ?? null,
    note: entry.note ?? null,
    timestamp: FieldValue.serverTimestamp(),
  });
};

function applyCors(req: functions.https.Request, res: functions.Response<any>) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-secret');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

function requireAdminSecret(req: functions.https.Request, res: functions.Response<any>) {
  const headerSecret = String(req.headers['x-admin-secret'] || '').trim();
  const bearerToken = String(req.headers.authorization || '').startsWith('Bearer ')
    ? String(req.headers.authorization || '').slice(7).trim()
    : '';
  const queryToken = String(req.query?.secret || '').trim();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const bodyToken = typeof (body as { secret?: unknown }).secret === 'string'
    ? String((body as { secret?: unknown }).secret).trim()
    : '';
  const provided = headerSecret || bearerToken || queryToken || bodyToken;
  if (ADMIN_SECRETS.length === 0 || !provided || !ADMIN_SECRETS.includes(provided)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

function readRequestBody(req: functions.https.Request) {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function parseBoolean(raw: unknown, fallback = false) {
  if (raw == null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function parsePositiveInt(raw: unknown, fallback: number, max: number) {
  if (raw == null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'value must be a positive number');
  }
  return Math.min(Math.floor(parsed), max);
}

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
      const nowMs = Date.now();
      const expiresAt = getTransferListingExpiresAtIso(nowMs);
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
        expiresAt,
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
      const buyerFinanceRef = financeDoc(buyerTeamId);
      const purchaseRef = purchaseId ? db.collection('purchases').doc(purchaseId) : null;

      const purchaseResult = await db.runTransaction(async tx => {
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
        const listing = listingSnap.data() as ListingDoc & { createdAt?: unknown };
        const isSystemGeneratedListing = listing.systemGenerated === true;
        if (listing.status !== 'active') {
          throw new functions.https.HttpsError('failed-precondition', 'ALREADY_SOLD');
        }
        if (isTransferListingExpired(listing, Date.now())) {
          await resetPlayerMarketState(tx, listing);
          tx.update(listingRef, {
            status: 'expired',
            expiredAt: FieldValue.serverTimestamp(),
            expiryReason: `stale_${TRANSFER_LISTING_TTL_DAYS}d`,
          });
          return { soldAt: '', expired: true };
        }
        if (listing.sellerUid === uid) {
          throw new functions.https.HttpsError('failed-precondition', 'SELF_PURCHASE');
        }

        const [buyerTeamSnap, buyerFinanceSnap] = await Promise.all([
          tx.get(buyerTeamRef),
          tx.get(buyerFinanceRef),
        ]);
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

        const buyerBudget = resolveTeamFinanceBalance(
          buyerTeam,
          buyerFinanceSnap.exists ? ((buyerFinanceSnap.data() as { balance?: number }) ?? null) : null,
        );
        if (buyerBudget < price) {
          throw new functions.https.HttpsError('resource-exhausted', 'INSUFFICIENT_FUNDS');
        }

        const sellerTeamId = String(listing.sellerTeamId ?? listing.teamId ?? '');
        const sellerTeamRef = sellerTeamId ? db.collection('teams').doc(sellerTeamId) : null;
        const sellerFinanceRef = sellerTeamId ? financeDoc(sellerTeamId) : null;
        const sellerTeamSnap = sellerTeamRef ? await tx.get(sellerTeamRef).catch(() => null) : null;
        const sellerTeam = sellerTeamSnap?.exists ? (sellerTeamSnap.data() as TeamDoc) : null;
        const sellerFinanceSnap =
          sellerFinanceRef ? await tx.get(sellerFinanceRef).catch(() => null) : null;
        const sellerBudget = resolveTeamFinanceBalance(
          sellerTeam,
          sellerFinanceSnap?.exists ? ((sellerFinanceSnap.data() as { balance?: number }) ?? null) : null,
        );

        const playerPath = typeof listing.playerPath === 'string' ? listing.playerPath : '';
        const playerRef = playerPath ? db.doc(playerPath) : null;
        const playerSnap = playerRef ? await tx.get(playerRef).catch(() => null) : null;

        let playerData: PlayerSnapshot | null = null;
        if (isSystemGeneratedListing) {
          playerData = sanitizePlayerForListing(listing.player ?? {}, String(listing.playerId ?? listingRef.id));
        } else if (playerSnap?.exists) {
          const snapshotData = playerSnap.data() as PlayerSnapshot;
          if (!snapshotData.market?.active || snapshotData.market?.listingId !== listingId) {
            throw new functions.https.HttpsError('failed-precondition', 'PLAYER_NOT_ON_MARKET');
          }
          playerData = snapshotData;
        }

        const sellerPlayers = !isSystemGeneratedListing && sellerTeam?.players ? [...sellerTeam.players] : undefined;
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
        setFinanceMirror(tx, buyerTeamId, updatedBuyerBudget);
        addFinanceHistoryEntry(tx, buyerTeamId, {
          type: 'expense',
          category: 'transfer',
          amount: price,
          source: listingId,
          note: `${updatedPlayer.name ?? playerId} transfer ucreti`,
        });

        if (
          !isSystemGeneratedListing &&
          sellerTeamRef &&
          sellerTeamSnap?.exists &&
          sellerTeamRef.path !== buyerTeamRef.path
        ) {
          const updatedSellerBudget = Math.round(sellerBudget + price);
          const sellerUpdates: DocumentData = {
            transferBudget: updatedSellerBudget,
            budget: updatedSellerBudget,
          };
          if (sellerPlayers) {
            sellerUpdates.players = sellerPlayers;
          }
          tx.update(sellerTeamRef, sellerUpdates);
          setFinanceMirror(tx, sellerTeamId, updatedSellerBudget);
          addFinanceHistoryEntry(tx, sellerTeamId, {
            type: 'income',
            category: 'transfer',
            amount: price,
            source: listingId,
            note: `${updatedPlayer.name ?? playerId} transfer geliri`,
          });
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

        const listingUpdates: DocumentData = {
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

      if (purchaseResult.expired) {
        throw new functions.https.HttpsError('failed-precondition', 'LISTING_EXPIRED');
      }

      return { ok: true, listingId, soldAt: purchaseResult.soldAt };
    } catch (error) {
      console.error('marketPurchaseListing error:', error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError('internal', (error as Error)?.message ?? 'INTERNAL');
    }
  });

const AUTO_RELIST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STALE_CLEANUP = 150;
const MAX_AUTO_LISTINGS_PER_RUN = 120;
const SYSTEM_MARKET_POSITIONS = [
  'GK',
  'CB',
  'CB',
  'LB',
  'RB',
  'CM',
  'CM',
  'LM',
  'RM',
  'CAM',
  'LW',
  'RW',
  'ST',
  'ST',
];
const SYSTEM_MARKET_FIRST_NAMES = [
  'Arda',
  'Baran',
  'Cem',
  'Deniz',
  'Eren',
  'Kaan',
  'Levent',
  'Mert',
  'Onur',
  'Ruzgar',
  'Sarp',
  'Tuna',
  'Yigit',
  'Emir',
  'Kerem',
  'Ozan',
];
const SYSTEM_MARKET_LAST_NAMES = [
  'Acar',
  'Aksoy',
  'Boran',
  'Demir',
  'Kaya',
  'Koc',
  'Ozkan',
  'Sahin',
  'Tas',
  'Yalcin',
  'Yildiz',
  'Arslan',
  'Kaplan',
  'Polat',
  'Uslu',
  'Yaman',
];

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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const hashSeed = (value: string) => {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number) => {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const getSystemMarketRoles = (position: string): string[] => {
  switch (position) {
    case 'GK':
      return ['GK'];
    case 'CB':
      return ['CB'];
    case 'LB':
      return ['LB', 'CB', 'LM'];
    case 'RB':
      return ['RB', 'CB', 'RM'];
    case 'CM':
      return ['CM', 'CAM', 'LM', 'RM'];
    case 'LM':
      return ['LM', 'LW', 'CM'];
    case 'RM':
      return ['RM', 'RW', 'CM'];
    case 'CAM':
      return ['CAM', 'CM', 'ST'];
    case 'LW':
      return ['LW', 'LM', 'ST'];
    case 'RW':
      return ['RW', 'RM', 'ST'];
    case 'ST':
      return ['ST', 'CAM', 'LW', 'RW'];
    default:
      return [position || 'CM'];
  }
};

const getSystemMarketSalary = (overall: number): number => {
  const rating = normalizeRatingTo100Value(overall);
  if (rating <= 45) return 4_000;
  if (rating <= 55) return 6_500;
  if (rating <= 65) return 9_500;
  if (rating <= 75) return 14_500;
  return 22_000;
};

const pickSystemOverall = (rand: () => number): number => {
  const bucket = rand();
  if (bucket < 0.72) {
    return Number(((45 + rand() * 20) / 100).toFixed(3));
  }
  if (bucket < 0.94) {
    return Number(((66 + rand() * 9) / 100).toFixed(3));
  }
  return Number(((76 + rand() * 6) / 100).toFixed(3));
};

const buildSystemMarketAttributes = (overall: number, rand: () => number) => {
  const next = () => Number(clamp(overall + (rand() - 0.5) * 0.16, 0.25, 0.92).toFixed(3));
  return {
    strength: next(),
    acceleration: next(),
    topSpeed: next(),
    dribbleSpeed: next(),
    jump: next(),
    tackling: next(),
    ballKeeping: next(),
    passing: next(),
    longBall: next(),
    agility: next(),
    shooting: next(),
    shootPower: next(),
    positioning: next(),
    reaction: next(),
    ballControl: next(),
  };
};

export const buildSystemMarketPlayer = (seed: string, index: number): PlayerSnapshot => {
  const rand = mulberry32(hashSeed(`${seed}:${index}`));
  const position = SYSTEM_MARKET_POSITIONS[index % SYSTEM_MARKET_POSITIONS.length] ?? 'CM';
  const overall = pickSystemOverall(rand);
  const potential = Number(clamp(overall + 0.03 + rand() * 0.13, overall, 0.9).toFixed(3));
  const firstName = SYSTEM_MARKET_FIRST_NAMES[Math.floor(rand() * SYSTEM_MARKET_FIRST_NAMES.length)] ?? 'Pazar';
  const lastName = SYSTEM_MARKET_LAST_NAMES[Math.floor(rand() * SYSTEM_MARKET_LAST_NAMES.length)] ?? 'Oyuncusu';
  const playerId = `market-${seed}-${index}`;

  return {
    id: playerId,
    uniqueId: playerId,
    name: `${firstName} ${lastName}`,
    position,
    roles: getSystemMarketRoles(position),
    overall,
    potential,
    attributes: buildSystemMarketAttributes(overall, rand),
    age: Math.floor(18 + rand() * 17),
    ageUpdatedAt: new Date().toISOString(),
    height: Math.round(170 + rand() * 25),
    weight: Math.round(65 + rand() * 22),
    health: 1,
    condition: Number((0.85 + rand() * 0.15).toFixed(3)),
    motivation: Number((0.85 + rand() * 0.15).toFixed(3)),
    injuryStatus: 'healthy',
    squadRole: 'reserve',
    ownerUid: SYSTEM_MARKET_SELLER_ID,
    teamId: SYSTEM_MARKET_SELLER_ID,
    market: {
      active: true,
      listingId: null,
      autoListReason: 'market_top_up',
    },
    contract: {
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      salary: getSystemMarketSalary(overall),
      extensions: 0,
    },
  };
};

export const resolveTransferMarketTopUpAmount = (
  activeCount: number,
  targetCount = TRANSFER_MARKET_TARGET_ACTIVE_LISTINGS,
  limit = MAX_SYSTEM_MARKET_TOP_UP_PER_RUN,
): number => {
  const safeActive = Math.max(0, Math.floor(Number.isFinite(activeCount) ? activeCount : 0));
  const safeTarget = Math.max(1, Math.floor(Number.isFinite(targetCount) ? targetCount : TRANSFER_MARKET_TARGET_ACTIVE_LISTINGS));
  const safeLimit = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : MAX_SYSTEM_MARKET_TOP_UP_PER_RUN));
  return Math.min(Math.max(0, safeTarget - safeActive), safeLimit);
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

export const resolveTransferListingExpiresAtMs = (
  listing: Pick<ListingDoc, 'expiresAt'> & { createdAt?: unknown },
): number | null => {
  const explicitExpiresAt = parseMillis(listing.expiresAt ?? null);
  if (explicitExpiresAt !== null) return explicitExpiresAt;
  const createdAtMs = parseMillis(listing.createdAt ?? null);
  return createdAtMs === null ? null : createdAtMs + TRANSFER_LISTING_TTL_MS;
};

export const isTransferListingExpired = (
  listing: Pick<ListingDoc, 'expiresAt'> & { createdAt?: unknown },
  nowMs: number,
): boolean => {
  const expiresAtMs = resolveTransferListingExpiresAtMs(listing);
  return expiresAtMs !== null && expiresAtMs <= nowMs;
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
      const expiresAt = getTransferListingExpiresAtIso(nowMs);
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
        sellerTeamName: team.name ?? 'Takımım',
        status: 'active',
        expiresAt,
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
    const nowMs = Date.now();
    const cutoffMs = nowMs - TRANSFER_LISTING_TTL_MS;
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
          const listing = listingSnap.data() as ListingDoc & { createdAt?: unknown };
          if (listing.status !== 'active') return;
          if (!isTransferListingExpired(listing, nowMs)) return;

          await resetPlayerMarketState(tx, listing);
          tx.update(doc.ref, {
            status: 'expired',
            expiredAt: FieldValue.serverTimestamp(),
            expiryReason: `stale_${TRANSFER_LISTING_TTL_DAYS}d`,
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
      ttlDays: TRANSFER_LISTING_TTL_DAYS,
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

type TopUpTransferMarketOptions = {
  dryRun?: boolean;
  targetCount?: number;
  limit?: number;
};

type TopUpTransferMarketResult = {
  dryRun: boolean;
  activeCount: number;
  targetCount: number;
  requested: number;
  created: number;
  sample: Array<{
    playerId: string;
    playerName?: string;
    pos?: string;
    overall?: number;
    price: number;
  }>;
};

const buildSystemListingPayload = (
  listingId: string,
  player: PlayerSnapshot,
  nowIso: string,
): ListingDoc & {
  systemGenerated: true;
  autoListed: true;
  autoListReason: 'market_top_up';
  autoListedAt: string;
} => {
  const playerId = String(player.id ?? `market-${listingId}`);
  const createdAtMs = Date.parse(nowIso);
  const expiresAt = getTransferListingExpiresAtIso(Number.isFinite(createdAtMs) ? createdAtMs : Date.now());
  const sanitizedPlayer: PlayerSnapshot = {
    ...sanitizePlayerForListing(player, playerId),
    id: playerId,
    ownerUid: SYSTEM_MARKET_SELLER_ID,
    teamId: SYSTEM_MARKET_SELLER_ID,
    market: {
      ...(player.market ?? { active: true, listingId }),
      active: true,
      listingId,
      autoListedAt: nowIso,
      autoListReason: 'market_top_up',
    },
  };

  return {
    sellerUid: SYSTEM_MARKET_SELLER_ID,
    sellerId: SYSTEM_MARKET_SELLER_ID,
    teamId: SYSTEM_MARKET_SELLER_ID,
    sellerTeamId: SYSTEM_MARKET_SELLER_ID,
    playerId,
    playerPath: '',
    price: computeAutoListingPrice(sanitizedPlayer),
    player: sanitizedPlayer,
    playerName: sanitizedPlayer.name,
    position: sanitizedPlayer.position,
    pos: sanitizedPlayer.position,
    overall: sanitizedPlayer.overall,
    sellerTeamName: SYSTEM_MARKET_SELLER_NAME,
    status: 'active',
    expiresAt,
    systemGenerated: true,
    autoListed: true,
    autoListReason: 'market_top_up',
    autoListedAt: nowIso,
  };
};

export async function topUpTransferMarketInternal(
  options: TopUpTransferMarketOptions = {},
): Promise<TopUpTransferMarketResult> {
  const targetCount = Math.min(
    parsePositiveInt(options.targetCount, TRANSFER_MARKET_TARGET_ACTIVE_LISTINGS, 500),
    500,
  );
  const limit = parsePositiveInt(options.limit, MAX_SYSTEM_MARKET_TOP_UP_PER_RUN, MAX_SYSTEM_MARKET_TOP_UP_PER_RUN);
  const dryRun = options.dryRun === true;

  const activeSnap = await listingsCollection
    .where('status', '==', 'active')
    .select()
    .limit(targetCount)
    .get();
  const activeCount = activeSnap.size;
  const requested = resolveTransferMarketTopUpAmount(activeCount, targetCount, limit);
  const now = new Date();
  const nowIso = now.toISOString();
  const seed = `${now.toISOString().slice(0, 10)}-${Date.now()}`;

  const sample: TopUpTransferMarketResult['sample'] = [];
  if (requested <= 0) {
    return {
      dryRun,
      activeCount,
      targetCount,
      requested: 0,
      created: 0,
      sample,
    };
  }

  const batch = db.batch();
  for (let i = 0; i < requested; i++) {
    const listingRef = listingsCollection.doc();
    const player = buildSystemMarketPlayer(listingRef.id || seed, i);
    const payload = buildSystemListingPayload(listingRef.id, player, nowIso);
    sample.push({
      playerId: payload.playerId,
      playerName: payload.playerName,
      pos: payload.pos,
      overall: payload.overall,
      price: payload.price,
    });

    if (!dryRun) {
      batch.set(listingRef, {
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }

  if (!dryRun) {
    await batch.commit();
  }

  return {
    dryRun,
    activeCount,
    targetCount,
    requested,
    created: dryRun ? 0 : requested,
    sample,
  };
}

export const topUpTransferMarketDaily = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .region(region)
  .pubsub.schedule(TOP_UP_TRANSFER_MARKET_CRON)
  .timeZone(TZ)
  .onRun(async () => {
    const result = await topUpTransferMarketInternal();
    functions.logger.info('[market] topUpTransferMarketDaily complete', result);
    return result;
  });

export const topUpTransferMarketHttp = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .region(region)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }
    if (!requireAdminSecret(req, res)) return;

    try {
      const body = readRequestBody(req);
      const result = await topUpTransferMarketInternal({
        dryRun: parseBoolean(body.dryRun ?? req.query?.dryRun, false),
        targetCount: parsePositiveInt(
          body.targetCount ?? req.query?.targetCount,
          TRANSFER_MARKET_TARGET_ACTIVE_LISTINGS,
          500,
        ),
        limit: parsePositiveInt(
          body.limit ?? req.query?.limit,
          MAX_SYSTEM_MARKET_TOP_UP_PER_RUN,
          MAX_SYSTEM_MARKET_TOP_UP_PER_RUN,
        ),
      });
      res.json({ ok: true, ...result });
    } catch (error: any) {
      functions.logger.error('[market] topUpTransferMarketHttp failed', {
        error: error?.message || String(error),
      });
      res.status(500).json({ ok: false, error: error?.message || 'internal' });
    }
  });

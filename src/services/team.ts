import { doc, setDoc, getDoc, runTransaction } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import type { User as FirebaseAuthUser } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '@/services/firebase';
import { Player, ClubTeam, CustomFormationMap, TeamBadge, TeamKitAssets } from '@/types';
import { generateRandomName } from '@/lib/names';
import { calculateOverall, getRoles } from '@/lib/player';
import { addGameYears, applyGameAgingToPlayers } from '@/lib/gameTime';
import { formations } from '@/lib/formations';

const positions: Player['position'][] = ['GK','CB','LB','RB','CM','LM','RM','CAM','LW','RW','ST'];

const CONTRACT_MIN_YEARS = 2;
const CONTRACT_MAX_YEARS = 4;

const createInitialContract = (): NonNullable<Player['contract']> => {
  const years = Math.floor(Math.random() * (CONTRACT_MAX_YEARS - CONTRACT_MIN_YEARS + 1)) + CONTRACT_MIN_YEARS;
  const expiresAt = addGameYears(new Date(), years).toISOString();
  return {
    expiresAt,
    status: 'active',
    salary: Math.floor(1500 + Math.random() * 3500),
    extensions: 0,
  };
};

const createInitialRenameState = (): NonNullable<Player['rename']> => ({
  adAvailableAt: new Date(0).toISOString(),
  lastMethod: undefined,
  lastUpdatedAt: undefined,
});

const clampPercentage = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(100, numeric));
  return Number(clamped.toFixed(4));
};

const randomAttr = () => parseFloat(Math.random().toFixed(3));
const randomGauge = () => parseFloat((0.6 + Math.random() * 0.4).toFixed(3));

const generatePlayer = (
  id: number,
  forcedPosition?: Player['position'],
): Player => {
  const position =
    forcedPosition || positions[Math.floor(Math.random() * positions.length)];
  const attributes = {
    strength: randomAttr(),
    acceleration: randomAttr(),
    topSpeed: randomAttr(),
    dribbleSpeed: randomAttr(),
    jump: randomAttr(),
    tackling: randomAttr(),
    ballKeeping: randomAttr(),
    passing: randomAttr(),
    longBall: randomAttr(),
    agility: randomAttr(),
    shooting: randomAttr(),
    shootPower: randomAttr(),
    positioning: randomAttr(),
    reaction: randomAttr(),
    ballControl: randomAttr(),
  } as Player['attributes'];
  const overall = calculateOverall(position, attributes);
  const potential = Math.min(1, overall + Math.random() * (1 - overall));
  return {
    id: String(id),
    name: generateRandomName(),
    position,
    roles: getRoles(position),
    overall,
    potential,
    attributes,
    age: Math.floor(Math.random() * 17) + 18,
    ageUpdatedAt: new Date().toISOString(),
    height: 180,
    weight: 75,
    squadRole: 'reserve',
    condition: randomGauge(),
    motivation: randomGauge(),
    injuryStatus: 'healthy',
    contract: createInitialContract(),
    rename: createInitialRenameState(),
  };
};

const generateTeamData = (id: string, name: string, manager: string): ClubTeam => {
  const players: Player[] = [];
  const startingPositions = formations[0].positions.map(p => p.position);
  startingPositions.forEach((pos, idx) => {
    players.push(generatePlayer(idx + 1, pos));
  });
  for (let i = startingPositions.length; i < 30; i++) {
    players.push(generatePlayer(i + 1));
  }
  players.slice(0, 11).forEach(p => (p.squadRole = 'starting'));
  players.slice(11, 22).forEach(p => (p.squadRole = 'bench'));
  players.slice(22).forEach(p => (p.squadRole = 'reserve'));
  return {
    id,
    name,
    manager,
    kitHome: 'home',
    kitAway: 'away',
    logo: null,
    budget: 0,
    transferBudget: 0,
    players,
  };
};

type CreateInitialTeamOptions = {
  /**
   * Explicit Firebase user instance to use for token refresh.
   * Useful immediately after sign-up when `auth.currentUser` may still be `null`.
   */
  authUser?: FirebaseAuthUser | null;
};

export const createInitialTeam = async (
  userId: string,
  teamName: string,
  manager: string,
  options?: CreateInitialTeamOptions,
): Promise<ClubTeam> => {
  const team = generateTeamData(userId, teamName, manager);
  // Firestore security rules require ownerUid on create and forbid setting leagueId from client
  const teamRef = doc(db, 'teams', userId);
  const payload = { ...team, ownerUid: userId };
  const sanitizedPayload = sanitizeFirestoreData(payload);

  const tryWrite = () => setDoc(teamRef, sanitizedPayload);

  try {
    await tryWrite();
  } catch (error) {
    const firebaseError = error as FirebaseError;
    if (firebaseError.code !== 'permission-denied') {
      throw firebaseError;
    }

    const candidates: (FirebaseAuthUser | null | undefined)[] = [
      auth.currentUser,
      options?.authUser,
    ];

    let lastError: Error | FirebaseError | null = firebaseError;

    for (const candidate of candidates) {
      if (!candidate || candidate.uid !== userId) {
        continue;
      }

      try {
        await candidate.getIdToken(true);
      } catch (refreshError) {
        lastError =
          refreshError instanceof Error
            ? refreshError
            : new Error(String((refreshError as { message?: unknown })?.message ?? refreshError ?? 'token refresh failed'));
        continue;
      }

      try {
        await tryWrite();
        lastError = null;
        break;
      } catch (retryError) {
        lastError =
          retryError instanceof Error
            ? retryError
            : new Error(String((retryError as { message?: unknown })?.message ?? retryError ?? 'team write retry failed'));
      }
    }

    if (lastError) {
      console.error('[team.createInitialTeam] Token refresh retry failed', lastError);
      throw lastError;
    }
  }
  return team;
};

export const getTeam = async (userId: string): Promise<ClubTeam | null> => {
  const ref = doc(db, 'teams', userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return null;
  }

  const team = snap.data() as ClubTeam | null;
  if (!team) {
    return null;
  }

  const leagueId =
    typeof (team as { leagueId?: string | null } | null)?.leagueId === 'string'
      ? (team as { leagueId?: string | null }).leagueId
      : null;

  const { players: agedPlayers, changed } = applyGameAgingToPlayers(
    team.players ?? [],
    new Date(),
    { leagueId },
  );

  const currentUid = auth.currentUser?.uid;
  const canPersist =
    !!currentUid && (currentUid === userId || (team as { ownerUid?: string }).ownerUid === currentUid);

  if (changed && canPersist) {
    try {
      await saveTeamPlayers(userId, agedPlayers);
    } catch (error) {
      console.warn('[team.getTeam] failed to persist calendar aging', error);
    }
  }

  return {
    ...team,
    players: agedPlayers,
  };
};

export const updateTeamName = async (userId: string, teamName: string) => {
  await setDoc(
    doc(db, 'teams', userId),
    { name: teamName },
    { merge: true },
  );
};

export const updateTeamLogo = async (userId: string, logo: string | null) => {
  const payload = sanitizeFirestoreData({ logo: logo ?? null });
  await setDoc(
    doc(db, 'teams', userId),
    payload,
    { merge: true },
  );
};

export const updateTeamAssets = async (
  userId: string,
  payload: { badge?: TeamBadge | null; kit?: TeamKitAssets | null },
) => {
  const sanitized = sanitizeFirestoreData(payload);
  await setDoc(doc(db, 'teams', userId), sanitized, { merge: true });
};

export const adjustTeamBudget = async (userId: string, amount: number): Promise<number> => {
  const teamRef = doc(db, 'teams', userId);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(teamRef);
    if (!snapshot.exists()) {
      throw new Error('Takım bulunamadı.');
    }

    const data = snapshot.data() as ClubTeam | undefined;
    const currentBudget = Number.isFinite(data?.transferBudget)
      ? Number(data?.transferBudget)
      : Number.isFinite(data?.budget)
        ? Number(data?.budget)
        : 0;
    const nextBudget = Math.max(0, Math.round(currentBudget + amount));

    transaction.update(teamRef, { budget: nextBudget, transferBudget: nextBudget });
    return nextBudget;
  });
};

type TeamPlanUpdate = {
  formation?: string;
  shape?: string;
  tactics?: Record<string, unknown>;
  squads?: {
    starters?: string[];
    bench?: string[];
    reserves?: string[];
  };
  customFormations?: CustomFormationMap;
};

const sanitizeFirestoreData = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeFirestoreData(item)) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, itemValue]) => itemValue !== undefined)
      .map(([key, itemValue]) => [key, sanitizeFirestoreData(itemValue)] as const);

    return Object.fromEntries(entries) as T;
  }

  return value;
};

export const saveTeamPlayers = async (userId: string, players: Player[], plan?: TeamPlanUpdate) => {
  const payload: Record<string, unknown> = { players: sanitizeFirestoreData(players) };

  if (plan) {
    const { formation, shape, squads, tactics, customFormations } = plan;
    const dedupe = (list?: string[]) =>
      Array.from(new Set((list ?? []).map(id => String(id)))).filter(Boolean);

    const sanitizedFormation =
      typeof formation === 'string' && formation.trim().length > 0
        ? formation.trim()
        : 'auto';

    const sanitizedShape =
      typeof shape === 'string' && shape.trim().length > 0
        ? shape.trim()
        : undefined;

    const sanitizedSquads = {
      starters: dedupe(squads?.starters),
      bench: dedupe(squads?.bench),
      reserves: dedupe(squads?.reserves),
    };

    const rosterIds = new Set(players.map(player => String(player.id)));
    const allowedStarterIds = new Set(sanitizedSquads.starters);
    const unknownIds = [
      ...sanitizedSquads.starters,
      ...sanitizedSquads.bench,
      ...sanitizedSquads.reserves,
    ].filter(id => !rosterIds.has(id));

    if (unknownIds.length > 0) {
      throw new Error('Unknown player ids: ' + unknownIds.join(', '));
    }

    const timestamp = new Date().toISOString();
    const sanitizedTactics =
      tactics && typeof tactics === 'object' ? (tactics as Record<string, unknown>) : {};

    const sanitizeCustomFormations = (
      layouts?: CustomFormationMap,
    ): CustomFormationMap | undefined => {
      if (!layouts || typeof layouts !== 'object') {
        return undefined;
      }

      const sanitized: CustomFormationMap = {};

      Object.entries(layouts).forEach(([formationKey, layout]) => {
        if (!layout || typeof layout !== 'object') {
          return;
        }

        const sanitizedLayout: CustomFormationMap[string] = {};

        Object.entries(layout).forEach(([playerId, value]) => {
          const key = String(playerId);
          if (!rosterIds.has(key) || !allowedStarterIds.has(key)) {
            return;
          }

          if (!value || typeof value !== 'object') {
            return;
          }

          const x = clampPercentage((value as { x?: unknown }).x);
          const y = clampPercentage((value as { y?: unknown }).y);
          const rawPosition = (value as { position?: unknown }).position;
          const normalizedPosition =
            typeof rawPosition === 'string' && positions.includes(rawPosition.toUpperCase() as Player['position'])
              ? (rawPosition.toUpperCase() as Player['position'])
              : 'CM';

          sanitizedLayout[key] = { x, y, position: normalizedPosition };
        });

        if (Object.keys(sanitizedLayout).length > 0) {
          sanitized[String(formationKey)] = sanitizedLayout;
        }
      });

      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    };

    const sanitizedCustomFormations = sanitizeCustomFormations(customFormations);

    payload.plan = {
      formation: sanitizedFormation,
      starters: sanitizedSquads.starters,
      bench: sanitizedSquads.bench,
      reserves: sanitizedSquads.reserves,
      updatedAt: timestamp,
      ...(sanitizedShape ? { shape: sanitizedShape } : {}),
      ...(sanitizedCustomFormations ? { customFormations: sanitizedCustomFormations } : {}),
    };

    payload.lineup = {
      formation: sanitizedFormation,
      tactics: sanitizedTactics,
      starters: sanitizedSquads.starters,
      subs: sanitizedSquads.bench,
      reserves: sanitizedSquads.reserves,
      updatedAt: timestamp,
      ...(sanitizedShape ? { shape: sanitizedShape } : {}),
      ...(sanitizedCustomFormations ? { customFormations: sanitizedCustomFormations } : {}),
    };
  }

  await setDoc(doc(db, 'teams', userId), sanitizeFirestoreData(payload), { merge: true });
};



const renameClubCallable = httpsCallable<{ name: string }, RenameClubResponse>(functions, 'renameClub');
const renameStadiumCallable = httpsCallable<{ name: string }, RenameStadiumResponse>(functions, 'renameStadium');

type RenameClubResponse = {
  diamondBalance: number;
  teamName: string;
};

type RenameStadiumResponse = {
  diamondBalance: number;
  stadiumName: string;
};

export const renameClubWithDiamonds = async (teamName: string): Promise<RenameClubResponse> => {
  const response = await renameClubCallable({ name: teamName });
  return response.data;
};

export const renameStadiumWithDiamonds = async (stadiumName: string): Promise<RenameStadiumResponse> => {
  const response = await renameStadiumCallable({ name: stadiumName });
  return response.data;
};
export const addPlayerToTeam = async (userId: string, player: Player) => {
  const team = await getTeam(userId);
  if (!team) return;
  const updatedPlayers = [
    ...team.players,
    { ...player, injuryStatus: player.injuryStatus ?? 'healthy', squadRole: 'reserve' as const },
  ];
  await setDoc(doc(db, 'teams', userId), { players: updatedPlayers }, { merge: true });
  return updatedPlayers;
};

export const updatePlayerSalary = async (userId: string, playerId: string, salary: number): Promise<void> => {
  const teamRef = doc(db, 'teams', userId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(teamRef);
    if (!snap.exists()) {
      throw new Error('Takim bulunamadi.');
    }
    const data = snap.data() as { players?: Player[] };
    const players = data.players ?? [];
    const index = players.findIndex((player) => String(player.id) === String(playerId));
    if (index === -1) {
      throw new Error('Oyuncu bulunamadi.');
    }
    const player = players[index];
    const contract = {
      status: player.contract?.status ?? 'active',
      salary,
      expiresAt: player.contract?.expiresAt ?? addGameYears(new Date(), 1).toISOString(),
      extensions: player.contract?.extensions ?? 0,
    };
    const nextPlayers = [...players];
    nextPlayers[index] = { ...player, contract };
    tx.update(teamRef, { players: nextPlayers });
  });
};

/**
 * Server-side lineup setter (calls Cloud Function 'setLineup')
 */
export async function setLineupServer(params: {
  teamId: string;
  formation?: string;
  tactics?: Record<string, any>;
  starters: string[];
  subs?: string[];
  reserves?: string[];
}): Promise<void> {
  const dedupe = (list?: string[]) => Array.from(new Set((list ?? []).map(String))).filter(Boolean);
  const starters = dedupe(params.starters);
  const subs = dedupe(params.subs);
  const reserves = dedupe(params.reserves);

  const fn = httpsCallable(functions, 'setLineup');
  await fn({
    teamId: params.teamId,
    formation: params.formation || 'auto',
    tactics: params.tactics || {},
    starters,
    subs,
    reserves,
  });
}

import { doc, getDoc } from 'firebase/firestore';
import type { ClubTeam } from '@/types';
import { db } from './firebase';

export type LiveTeamIdentity = {
  id: string;
  teamName: string | null;
  managerName: string | null;
  logo: string | null;
};

const CACHE_TTL_MS = 5_000;

const identityCache = new Map<string, { value: LiveTeamIdentity; expiresAt: number }>();
const pendingIdentityLoads = new Map<string, Promise<LiveTeamIdentity | null>>();

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

const parseIdentity = (teamId: string, data: Partial<ClubTeam> | undefined): LiveTeamIdentity => ({
  id: teamId,
  teamName: normalizeString(data?.name),
  managerName: normalizeString(data?.manager),
  logo: normalizeString(data?.logo) ?? null,
});

export async function resolveLiveTeamIdentity(teamId: string): Promise<LiveTeamIdentity | null> {
  const normalizedTeamId = typeof teamId === 'string' ? teamId.trim() : '';
  if (!normalizedTeamId) {
    return null;
  }

  const now = Date.now();
  const cached = identityCache.get(normalizedTeamId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const pending = pendingIdentityLoads.get(normalizedTeamId);
  if (pending) {
    return pending;
  }

  const loadPromise = (async () => {
    try {
      const snapshot = await getDoc(doc(db, 'teams', normalizedTeamId));
      if (!snapshot.exists()) {
        return cached?.value ?? null;
      }

      const identity = parseIdentity(normalizedTeamId, snapshot.data() as Partial<ClubTeam>);
      identityCache.set(normalizedTeamId, {
        value: identity,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return identity;
    } catch {
      return cached?.value ?? null;
    } finally {
      pendingIdentityLoads.delete(normalizedTeamId);
    }
  })();

  pendingIdentityLoads.set(normalizedTeamId, loadPromise);
  return loadPromise;
}

export async function resolveLiveTeamIdentities(
  teamIds: string[],
): Promise<Map<string, LiveTeamIdentity>> {
  const uniqueTeamIds = Array.from(
    new Set(
      teamIds
        .map((teamId) => (typeof teamId === 'string' ? teamId.trim() : ''))
        .filter(Boolean),
    ),
  );

  if (uniqueTeamIds.length === 0) {
    return new Map();
  }

  const resolvedEntries = await Promise.all(
    uniqueTeamIds.map(async (teamId) => [teamId, await resolveLiveTeamIdentity(teamId)] as const),
  );

  return new Map(
    resolvedEntries.filter((entry): entry is readonly [string, LiveTeamIdentity] => entry[1] !== null),
  );
}

export function clearLiveTeamIdentityCache(teamId?: string) {
  if (typeof teamId === 'string' && teamId.trim()) {
    identityCache.delete(teamId.trim());
    pendingIdentityLoads.delete(teamId.trim());
    return;
  }

  identityCache.clear();
  pendingIdentityLoads.clear();
}

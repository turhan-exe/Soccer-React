import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

export type TeamLookupResult = {
  exists: boolean;
  name: string;
  ownerUid?: string;
};

async function defaultTeamLookup(teamId: string): Promise<TeamLookupResult> {
  const snap = await db.doc(`teams/${teamId}`).get();
  if (!snap.exists) {
    return { exists: false, name: teamId };
  }
  const data = snap.data() as any;
  const name = data?.name || data?.clubName || `Team ${teamId}`;
  return { exists: true, name, ownerUid: data?.ownerUid };
}

export async function ensureLeagueTeamDocs(
  leagueId: string,
  teamIds: string[],
  opts?: {
    cache?: Map<string, boolean>;
    teamLookup?: (teamId: string) => Promise<TeamLookupResult>;
  }
) {
  const cache = opts?.cache ?? new Map<string, boolean>();
  const lookup = opts?.teamLookup ?? defaultTeamLookup;
  const uniqueTeamIds = Array.from(new Set(teamIds.filter(Boolean)));

  for (const teamId of uniqueTeamIds) {
    const key = `${leagueId}:${teamId}`;
    if (cache.has(key)) continue;

    const teamData = await lookup(teamId);
    if (!teamData.exists) {
      cache.set(key, false);
      continue;
    }

    const teamRef = db.doc(`leagues/${leagueId}/teams/${teamId}`);
    const teamSnap = await teamRef.get();
    if (!teamSnap.exists) {
      const payload: any = {
        teamId,
        name: teamData.name,
        joinedAt: FieldValue.serverTimestamp(),
      };
      if (teamData.ownerUid) payload.ownerUid = teamData.ownerUid;
      await teamRef.set(payload, { merge: true });
    }

    const standingsRef = db.doc(`leagues/${leagueId}/standings/${teamId}`);
    const standingsSnap = await standingsRef.get();
    if (!standingsSnap.exists) {
      await standingsRef.set(
        {
          teamId,
          name: teamData.name,
          P: 0,
          W: 0,
          D: 0,
          L: 0,
          GF: 0,
          GA: 0,
          GD: 0,
          Pts: 0,
        },
        { merge: true }
      );
    }

    cache.set(key, true);
  }
}

import { collection, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { MatchDocument, MatchReplayPayload } from '@/types/matchReplay';

const REGION = import.meta.env.VITE_FUNCTIONS_REGION || 'europe-west1';
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || '';
const DEFAULT_BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

export type MatchListItem = MatchDocument & { kickoffDate?: Date };

const getFunctionsBaseUrl = () =>
  (import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined) || DEFAULT_BASE_URL;

export async function fetchFinishedMatchesForClub(
  seasonId: string,
  clubId: string
): Promise<MatchListItem[]> {
  const matchesCol = collection(db, 'seasons', seasonId, 'matches');
  const baseQuery = (field: 'homeClubId' | 'awayClubId') =>
    query(matchesCol, where('status', '==', 'finished'), where(field, '==', clubId));

  const [homeSnap, awaySnap] = await Promise.all([getDocs(baseQuery('homeClubId')), getDocs(baseQuery('awayClubId'))]);
  const docs = [...homeSnap.docs, ...awaySnap.docs];
  const mapped: MatchListItem[] = docs.map((doc) => {
    const data = doc.data() as MatchDocument;
    const kickoffDate = typeof data.kickoffAt?.toDate === 'function' ? data.kickoffAt.toDate() : undefined;
    return { ...data, seasonId, matchId: doc.id, kickoffDate };
  });
  return mapped.sort((a, b) => (b.kickoffDate?.getTime() || 0) - (a.kickoffDate?.getTime() || 0));
}

export async function fetchMatchReplayPayload(
  seasonId: string,
  matchId: string
): Promise<MatchReplayPayload> {
  const baseUrl = getFunctionsBaseUrl();
  const url = `${baseUrl.replace(/\/$/, '')}/getMatchReplay?seasonId=${encodeURIComponent(seasonId)}&matchId=${encodeURIComponent(matchId)}`;
  const token = await auth.currentUser?.getIdToken?.().catch(() => undefined);
  const res = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Replay fetch failed (${res.status}): ${text}`);
  }
  return (await res.json()) as MatchReplayPayload;
}

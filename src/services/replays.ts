import { collectionGroup, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Fixture } from "@/types";
import type { MatchReplayPayload, MatchVideoMeta } from "@/types/matchReplay";

const REGION = import.meta.env.VITE_FUNCTIONS_REGION || "europe-west1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || "";
const DEFAULT_BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

export type MatchListItem = Fixture & { kickoffDate?: Date };

const getFunctionsBaseUrl = () =>
  (import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined) || DEFAULT_BASE_URL;

const mapFixture = (snap: any): MatchListItem => {
  const data = snap.data() as any;
  const ts = data.date as { toDate?: () => Date } | undefined;
  const kickoffDate = typeof ts?.toDate === "function" ? ts.toDate() : undefined;
  const leagueId = snap.ref.parent.parent?.id || "";
  const seasonId = data.seasonId ?? data.season ?? undefined;
  return {
    id: snap.id,
    round: data.round,
    date: kickoffDate || new Date(0),
    homeTeamId: data.homeTeamId,
    awayTeamId: data.awayTeamId,
    participants: data.participants ?? [data.homeTeamId, data.awayTeamId],
    status: data.status,
    score: data.score ?? null,
    replayPath: data.replayPath,
    goalTimeline: data.goalTimeline ?? [],
    leagueId,
    seasonId: seasonId ? String(seasonId) : undefined,
    video: data.video ?? null,
    videoMissing: data.videoMissing,
    videoError: data.videoError,
    kickoffDate,
  };
};

export async function fetchFinishedMatchesForClub(
  seasonId: string,
  clubId: string
): Promise<MatchListItem[]> {
  const baseQuery = query(
    collectionGroup(db, "fixtures"),
    where("status", "==", "played"),
    where("participants", "array-contains", clubId)
  );
  const snap = await getDocs(baseQuery);
  const mapped = snap.docs.map(mapFixture);
  const seasonKey = (seasonId || "").trim();
  const filtered = seasonKey
    ? mapped.filter((m) => String(m.seasonId || "") === seasonKey)
    : mapped;
  return filtered.sort((a, b) => (b.kickoffDate?.getTime() || 0) - (a.kickoffDate?.getTime() || 0));
}

export async function fetchMatchReplayPayload(
  seasonId: string,
  matchId: string
): Promise<MatchReplayPayload> {
  const baseUrl = getFunctionsBaseUrl();
  const url = `${baseUrl.replace(/\/$/, "")}/getMatchReplay?seasonId=${encodeURIComponent(seasonId)}&matchId=${encodeURIComponent(matchId)}`;
  const token = await auth.currentUser?.getIdToken?.().catch(() => undefined);
  const res = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replay fetch failed (${res.status}): ${text}`);
  }
  return (await res.json()) as MatchReplayPayload;
}

export async function fetchMatchDocument(
  leagueId: string,
  matchId: string
): Promise<MatchListItem | null> {
  if (!leagueId || !matchId) return null;
  const ref = doc(db, "leagues", leagueId, "fixtures", matchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return mapFixture(snap);
}

export async function fetchMatchVideoUrl(
  leagueId: string,
  matchId: string,
  video?: MatchVideoMeta | null
): Promise<string> {
  const directUrl = video?.signedUrl || video?.signedGetUrl;
  if (directUrl) return directUrl;
  if (!leagueId || !matchId) throw new Error("Video icin leagueId ve matchId gerekli");
  if (!video && !video?.storagePath) throw new Error("Video henuz yok");

  const qs = new URLSearchParams({
    leagueId,
    matchId,
    ...(video?.storagePath ? { storagePath: video.storagePath } : {}),
  });

  const baseUrl = getFunctionsBaseUrl();
  const token = await auth.currentUser?.getIdToken?.().catch(() => undefined);
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/getMatchVideo?${qs.toString()}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Video URL alinamadi");
  }
  const data = (await res.json().catch(() => null)) as any;
  const signedUrl = data?.url || data?.signedUrl;
  if (typeof signedUrl === "string" && signedUrl.length > 0) return signedUrl;
  if (data?.missing || data?.reason === "missing") throw new Error("Video henuz yok");
  throw new Error("Video URL alinamadi");
}

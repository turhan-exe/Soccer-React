import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchMatchDocument, fetchMatchVideoUrl } from "@/services/replays";
import type { MatchDocument } from "@/types/matchReplay";

const MatchVideoPage = () => {
  const [params] = useSearchParams();
  const seasonId = params.get("seasonId") || "";
  const matchId = params.get("matchId") || "";
  const [match, setMatch] = useState<MatchDocument | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!seasonId || !matchId) {
      setError("seasonId ve matchId gerekli");
      return;
    }
    setLoading(true);
    setError(null);
    setVideoUrl(null);
    fetchMatchDocument(seasonId, matchId)
      .then(async (doc) => {
        setMatch(doc);
        if (!doc) {
          throw new Error("Mac bulunamadi");
        }
        if (!doc.video) {
          throw new Error("Video henuz yok");
        }
        const url = await fetchMatchVideoUrl(seasonId, matchId, doc.video);
        setVideoUrl(url);
      })
      .catch((err) => setError(err?.message || "Video alinamadi"))
      .finally(() => setLoading(false));
  }, [seasonId, matchId]);

  const title = match ? "Mac Videosu" : "Video";
  const score = match?.result ? `${match.result.homeGoals} - ${match.result.awayGoals}` : "";
  const clubs = match ? `${match.homeClubId} vs ${match.awayClubId}` : "";

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase text-slate-500">{title}</div>
        <div className="text-2xl font-semibold">{clubs}</div>
        <div className="text-lg text-slate-600">{score}</div>
        <div className="text-xs text-slate-500">
          MatchId: {matchId} - Season: {seasonId}
        </div>
      </div>

      {loading && <div>Yukleniyor...</div>}
      {error && <div className="text-red-500">{error}</div>}
      {!loading && videoUrl && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-black shadow-sm">
          <video controls src={videoUrl} className="w-full" style={{ maxHeight: 640 }} />
        </div>
      )}
      {!loading && !videoUrl && !error && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          Video henuz yok.
        </div>
      )}
    </div>
  );
};

export default MatchVideoPage;

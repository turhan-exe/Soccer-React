import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchMatchDocument, fetchMatchVideoUrl } from "@/services/replays";
import type { Fixture } from "@/types";

const MatchVideoPage = () => {
  const [params] = useSearchParams();
  const leagueId = params.get("leagueId") || "";
  const matchId = params.get("matchId") || "";
  const [match, setMatch] = useState<Fixture | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!leagueId || !matchId) {
      setError("leagueId ve matchId gerekli");
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    setVideoUrl(null);
    fetchMatchDocument(leagueId, matchId)
      .then(async (doc) => {
        setMatch(doc);
        if (!doc) {
          throw new Error("Mac bulunamadi");
        }
        const videoError = doc.videoError || doc.video?.error;
        const hasSignedUrl = !!(doc.video?.signedUrl || doc.video?.signedGetUrl);
        const isReady = hasSignedUrl || !!doc.video?.uploaded;
        if (videoError) {
          setError(`Video hatasi: ${videoError}`);
          return;
        }
        if (!doc.video || !isReady) {
          setNotice(doc.videoMissing ? "Video henuz yok. Render devam ediyor olabilir." : "Video henuz yok.");
          return;
        }
        const url = await fetchMatchVideoUrl(leagueId, matchId, doc.video);
        setVideoUrl(url);
      })
      .catch((err) => setError(err?.message || "Video alinamadi"))
      .finally(() => setLoading(false));
  }, [leagueId, matchId]);

  const title = match ? "Mac Videosu" : "Video";
  const score = match?.score ? `${match.score.home} - ${match.score.away}` : "";
  const clubs = match ? `${match.homeTeamId} vs ${match.awayTeamId}` : "";

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase text-slate-500">{title}</div>
        <div className="text-2xl font-semibold">{clubs}</div>
        <div className="text-lg text-slate-600">{score}</div>
        <div className="text-xs text-slate-500">
          MatchId: {matchId} - League: {leagueId}
        </div>
      </div>

      {loading && <div>Yukleniyor...</div>}
      {error && <div className="text-red-500">{error}</div>}
      {!loading && notice && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {notice}
        </div>
      )}
      {!loading && videoUrl && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-black shadow-sm">
          <video controls src={videoUrl} className="w-full" style={{ maxHeight: 640 }} />
        </div>
      )}
      {!loading && !videoUrl && !error && !notice && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          Video henuz yok.
        </div>
      )}
    </div>
  );
};

export default MatchVideoPage;

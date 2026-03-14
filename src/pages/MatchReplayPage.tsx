import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import UnityReplayViewer from '@/components/unity/UnityReplayViewer';
import { fetchMatchReplayPayload } from '@/services/replays';
import type { MatchReplayPayload } from '@/types/matchReplay';

const MatchReplayPage: React.FC = () => {
  const [params] = useSearchParams();
  const seasonId = params.get('seasonId') || '';
  const matchId = params.get('matchId') || '';
  const [payload, setPayload] = useState<MatchReplayPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seasonId || !matchId) {
      setError('seasonId ve matchId gerekli');
      return;
    }
    setLoading(true);
    setError(null);
    fetchMatchReplayPayload(seasonId, matchId)
      .then(setPayload)
      .catch((err) => setError(err?.message || 'Replay alınamadı'))
      .finally(() => setLoading(false));
  }, [seasonId, matchId]);

  const header = useMemo(() => {
    if (!payload) return { title: 'Replay', score: 'Skor yok', duration: '' };
    const score = `${payload.summary.homeGoals} - ${payload.summary.awayGoals}`;
    const duration = `${(payload.durationMs / 1000).toFixed(0)} sn`;
    return { title: `${payload.home.clubName} vs ${payload.away.clubName}`, score, duration };
  }, [payload]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs uppercase text-slate-500">Maç</div>
          <div className="text-2xl font-semibold">{header.title}</div>
          <div className="text-lg text-slate-600">{header.score}</div>
          <div className="text-xs text-slate-500">Süre: {header.duration}</div>
        </div>
        <div className="text-xs text-slate-500">
          MatchId: {matchId} · Season: {seasonId}
        </div>
      </div>

      {loading && <div>Yükleniyor...</div>}
      {error && <div className="text-red-500">{error}</div>}
      {!loading && payload && (
        <div className="space-y-3">
          <UnityReplayViewer payload={payload} />
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="font-semibold text-slate-700">Özet</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-slate-600">
              <div>
                <div className="text-xs uppercase text-slate-400">Home</div>
                <div>{payload.home.clubName}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-400">Away</div>
                <div>{payload.away.clubName}</div>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-xs uppercase text-slate-400">Olaylar</div>
              {payload.summary.events.length === 0 && (
                <div className="text-slate-500">Olay kaydı yok.</div>
              )}
              <ul className="mt-1 space-y-1">
                {payload.summary.events.map((e, idx) => (
                  <li key={`${e.type}-${idx}`} className="flex items-center justify-between">
                    <span className="text-slate-600">
                      {e.minute}' {e.type} ({e.club})
                    </span>
                    {e.playerId && <span className="text-xs text-slate-500">#{e.playerId}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchReplayPage;

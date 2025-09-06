import React, { useEffect, useMemo, useState } from 'react';

type Props = {
  matchId: string;
  leagueId?: string | null;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeamName?: string;
  awayTeamName?: string;
};

/**
 * Embeds Unity WebGL match viewer in practice mode for the upcoming match.
 * Falls back to a simple message if Unity bundle is not available.
 */
export function UnityPracticeView({ matchId, leagueId, homeTeamId, awayTeamId, homeTeamName, awayTeamName }: Props) {
  const [unityOk, setUnityOk] = useState<boolean | null>(null);

  // Probe Unity availability
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    (async () => {
      try {
        const res = await fetch('/Unity/match-viewer/index.html', { signal: ctrl.signal, cache: 'no-store' });
        if (!cancelled) setUnityOk(res.ok);
      } catch {
        if (!cancelled) setUnityOk(false);
      } finally {
        clearTimeout(t);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(t);
      ctrl.abort();
    };
  }, []);

  const src = useMemo(() => {
    const params = new URLSearchParams();
    params.set('mode', 'practice');
    params.set('matchId', matchId);
    if (leagueId) params.set('leagueId', leagueId);
    if (homeTeamId) params.set('homeTeamId', homeTeamId);
    if (awayTeamId) params.set('awayTeamId', awayTeamId);
    if (homeTeamName) params.set('homeTeamName', homeTeamName);
    if (awayTeamName) params.set('awayTeamName', awayTeamName);
    return `/Unity/match-viewer/index.html?${params.toString()}`;
  }, [matchId, leagueId, homeTeamId, awayTeamId, homeTeamName, awayTeamName]);

  if (unityOk === null) return <div>Oynatıcı hazırlanıyor…</div>;
  if (!unityOk) return <div>Unity oynatıcı bulunamadı.</div>;

  return (
    <div className="w-full h-[640px] border rounded overflow-hidden bg-black">
      <iframe src={src} title="Unity Practice Viewer" className="w-full h-full" allowFullScreen />
    </div>
  );
}

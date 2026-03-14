import { useEffect, useState } from 'react';
import { ReplayPlayer } from './ReplayPlayer';

type Props = {
  matchId: string;
  replayUrl: string;
};

/**
 * Decides the best viewer: Unity (if available) or the built-in player.
 * Falls back gracefully to the built-in ReplayPlayer if Unity bundle is not served.
 */
export function MatchReplayView({ matchId, replayUrl }: Props) {
  const [unityOk, setUnityOk] = useState<boolean | null>(null);

  // Best-effort probe for Unity viewer presence
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    (async () => {
      try {
        const url = `${window.location.origin}/Unity/match-viewer/index.html`;
        const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: ctrl.signal });
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

  const unitySrc = `/Unity/match-viewer/index.html?${new URLSearchParams({
    matchId,
    replayUrl,
  }).toString()}`;

  if (unityOk) {
    return (
      <div className="w-full h-[640px] border rounded overflow-hidden bg-black">
        <iframe
          src={unitySrc}
          title="Unity Match Viewer"
          className="w-full h-full"
        />
      </div>
    );
  }

  if (unityOk === null) {
    return <div>Oynatici hazirlaniyor...</div>;
  }

  // Fallback
  return <ReplayPlayer url={replayUrl} />;
}

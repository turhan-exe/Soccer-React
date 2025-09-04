import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { ReplayPlayer } from '@/components/replay/ReplayPlayer';
import { getReplay } from '@/services/matches';
import { subscribeLive, type LiveEvent as LiveEv, type LiveMeta } from '@/services/live';
import { getFixtureByIdAcrossLeagues } from '@/services/leagues';

type Mode = 'loading' | 'live' | 'replay' | 'not-found';

export default function MatchWatcherPage() {
  const { id } = useParams<{ id: string }>();
  const [mode, setMode] = useState<Mode>('loading');
  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<LiveEv[]>([]);
  const [meta, setMeta] = useState<LiveMeta | null>(null);
  const unsubRef = useRef<() => void>();

  // Load fixture to decide between live vs replay
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      setMode('loading');
      try {
        const found = await getFixtureByIdAcrossLeagues(id);
        if (!found) {
          if (!cancelled) setMode('not-found');
          return;
        }
        // Prefer replay if available
        if (found.fixture.replayPath) {
          const url = await getReplay(found.fixture.replayPath);
          if (!cancelled) {
            setReplayUrl(url);
            setMode('replay');
          }
          return;
        }
        // Fallback to live subscription
        if (!cancelled) setMode('live');
      } catch (e) {
        console.warn('[MatchWatcher] failed to load fixture', e);
        if (!cancelled) setMode('live');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Live subscription when in live mode
  useEffect(() => {
    if (!id) return;
    if (mode !== 'live') return;
    unsubRef.current?.();
    setEvents([]);
    unsubRef.current = subscribeLive(
      id,
      (ev) => setEvents((prev) => [...prev, ev]),
      (m) => setMeta(m)
    );
    return () => {
      unsubRef.current?.();
      unsubRef.current = undefined;
    };
  }, [id, mode]);

  const lastEvents = useMemo(() => events.slice(-20), [events]);

  if (mode === 'loading') return <div className="p-4">Yükleniyor…</div>;
  if (mode === 'not-found') return <div className="p-4">Maç bulunamadı.</div>;
  if (mode === 'replay' && replayUrl) return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">Maç Kaydı</h1>
      <ReplayPlayer url={replayUrl} />
    </div>
  );

  // Live mode
  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">Canlı Maç</h1>
      {meta?.score && (
        <div className="text-sm">Skor: {meta.score.h} - {meta.score.a}</div>
      )}
      <Card className="p-3">
        <div className="text-sm text-muted-foreground mb-2">Son olaylar</div>
        <div className="space-y-1">
          {lastEvents.map((e, i) => (
            <div key={i} className="text-sm bg-muted/40 rounded px-2 py-1 font-mono">
              <span className="opacity-60">{e.seq}</span> • <b>{(e as any).type || (e as any).eventType}</b> —
              {e.payload ? ' ' + JSON.stringify(e.payload) : ''}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}


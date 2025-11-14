import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { MatchReplayView } from '@/components/replay/MatchReplayView';
import { getMatchTimeline, getReplay } from '@/services/matches';
import { subscribeLive, type LiveEvent as LiveEv, type LiveMeta } from '@/services/live';
import { getFixtureByIdAcrossLeagues } from '@/services/leagues';
import type { MatchTimeline } from '@/types';

type Mode = 'loading' | 'live' | 'replay' | 'not-found';

export default function MatchWatcherPage() {
  const { id } = useParams<{ id: string }>();
  const [mode, setMode] = useState<Mode>('loading');
  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<LiveEv[]>([]);
  const [meta, setMeta] = useState<LiveMeta | null>(null);
  const [matchTimeline, setMatchTimeline] = useState<MatchTimeline | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setMatchTimeline(null);
      return () => {
        cancelled = true;
      };
    }
    setMatchTimeline(null);
    (async () => {
      try {
        const timeline = await getMatchTimeline(id);
        if (cancelled) return;
        setMatchTimeline(timeline);
      } catch (err) {
        console.warn('[MatchWatcher] getMatchTimeline failed', err);
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
  const scoreboardSource = meta?.score ?? matchTimeline?.score ?? fixture?.score ?? null;
  const scoreboardLabel = scoreboardSource ? `${scoreboardSource.home} - ${scoreboardSource.away}` : null;
  const timelineCard =
    matchTimeline && matchTimeline.goalTimeline && matchTimeline.goalTimeline.length ? (
      <Card className="p-3">
        <div className="text-sm text-muted-foreground mb-2">Goller</div>
        <div className="space-y-1">
          {matchTimeline.goalTimeline.map((goal, idx) => (
            <div
              key={`${goal.minute}-${goal.team}-${idx}`}
              className="flex items-center justify-between text-sm font-medium"
            >
              <span>{goal.minute}'</span>
              <span className="text-left">
                {goal.team === 'home' ? 'Ev' : 'Deplasman'}
                {goal.description ? ` · ${goal.description}` : ''}
              </span>
              <span>
                {goal.homeScore}-{goal.awayScore}
              </span>
            </div>
          ))}
        </div>
      </Card>
    ) : null;

  if (mode === 'loading') return <div className="p-4">Yükleniyor…</div>;
  if (mode === 'not-found') return <div className="p-4">Maç bulunamadı.</div>;
  if (mode === 'replay' && replayUrl) return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">Maç Kaydı</h1>
      {scoreboardLabel && (
        <div className="text-sm font-semibold text-muted-foreground">Skor: {scoreboardLabel}</div>
      )}
      {timelineCard}
      <MatchReplayView matchId={id!} replayUrl={replayUrl} />
    </div>
  );

  // Live mode
  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">Canlı Maç</h1>
      {scoreboardLabel && (
        <div className="text-sm font-semibold text-muted-foreground">Skor: {scoreboardLabel}</div>
      )}
      {timelineCard}
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Shield } from 'lucide-react';
import { toast } from 'sonner';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import BackButton from '@/components/ui/back-button';
import { MatchReplayView } from '@/components/replay/MatchReplayView';
import { auth } from '@/services/firebase';
import { getMatchTimeline, getReplay } from '@/services/matches';
import { subscribeLive, type LiveEvent as LiveEv, type LiveMeta } from '@/services/live';
import { getFixtureByIdAcrossLeagues } from '@/services/leagues';
import { resolveEffectiveFixtureLiveState } from '@/lib/fixtureLive';
import {
  ensureMatchEntryAccess,
  getMatchEntryAccessOutcomeMessage,
} from '@/services/matchEntryAccess';
import { getMatchEntryAccessStatus } from '@/services/rewardedAds';
import type { Fixture, MatchTimeline } from '@/types';

type Mode = 'loading' | 'gated' | 'live' | 'replay' | 'not-found';

export default function MatchWatcherPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('loading');
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<LiveEv[]>([]);
  const [meta, setMeta] = useState<LiveMeta | null>(null);
  const [matchTimeline, setMatchTimeline] = useState<MatchTimeline | null>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateExpiresAt, setGateExpiresAt] = useState<string | null>(null);
  const unsubRef = useRef<() => void>();

  const matchEntryKind = fixture?.competitionType === 'champions_league' ? 'champions' : 'league';

  const unlockLiveView = useCallback(async () => {
    if (!fixture || !id) {
      return;
    }

    const userId = String(auth.currentUser?.uid || '').trim();
    if (!userId) {
      toast.error('Bu islem icin oturum acman gerekir.');
      return;
    }

    setGateLoading(true);
    try {
      const access = await ensureMatchEntryAccess({
        userId,
        matchKind: matchEntryKind,
        targetId: fixture.id,
        fixtureId: fixture.id,
        matchId: fixture.live?.matchId || undefined,
        competitionType: fixture.competitionType,
        surface: 'match_watcher',
      });

      if (access.outcome !== 'granted') {
        const message = getMatchEntryAccessOutcomeMessage(access);
        if (access.outcome === 'failed') {
          toast.error(message);
        } else {
          toast.info(message);
        }
        return;
      }

      setGateExpiresAt(access.expiresAtIso);
      setMode('live');
    } catch (error) {
      toast.error(getMatchEntryAccessOutcomeMessage(error));
    } finally {
      setGateLoading(false);
    }
  }, [fixture, id, matchEntryKind]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!id) {
        setFixture(null);
        setLeagueId(null);
        setMode('not-found');
        return;
      }

      setMode('loading');
      setGateExpiresAt(null);

      try {
        const found = await getFixtureByIdAcrossLeagues(id);
        if (!found) {
          if (!cancelled) {
            setFixture(null);
            setLeagueId(null);
            setMode('not-found');
          }
          return;
        }

        if (!cancelled) {
          setFixture(found.fixture);
          setLeagueId(found.leagueId);
        }

        if (found.fixture.replayPath) {
          const url = await getReplay(found.fixture.replayPath);
          if (!cancelled) {
            setReplayUrl(url);
            setMode('replay');
          }
          return;
        }

        const fixtureStatus = String(found.fixture.status || '').trim().toLowerCase();
        const liveState = resolveEffectiveFixtureLiveState(found.fixture);
        const requiresGate =
          fixtureStatus === 'running' &&
          Boolean(found.fixture.live?.matchId || liveState);

        if (!requiresGate) {
          if (!cancelled) {
            setMode('live');
          }
          return;
        }

        const userId = String(auth.currentUser?.uid || '').trim();
        if (!userId) {
          if (!cancelled) {
            setMode('gated');
          }
          return;
        }

        try {
          const access = await getMatchEntryAccessStatus({
            matchKind: found.fixture.competitionType === 'champions_league' ? 'champions' : 'league',
            targetId: found.fixture.id,
          });
          if (cancelled) {
            return;
          }
          setGateExpiresAt(access.active ? access.expiresAtIso : null);
          setMode(access.active ? 'live' : 'gated');
        } catch (statusError) {
          console.warn('[MatchWatcher] failed to resolve match-entry access', statusError);
          if (!cancelled) {
            setMode('gated');
          }
        }
      } catch (error) {
        console.warn('[MatchWatcher] failed to load fixture', error);
        if (!cancelled) {
          setMode('live');
        }
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
        if (!cancelled) {
          setMatchTimeline(timeline);
        }
      } catch (error) {
        console.warn('[MatchWatcher] getMatchTimeline failed', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id || mode !== 'live') {
      return;
    }

    unsubRef.current?.();
    setEvents([]);
    unsubRef.current = subscribeLive(
      id,
      (event) => setEvents((prev) => [...prev, event]),
      (nextMeta) => setMeta(nextMeta),
    );

    return () => {
      unsubRef.current?.();
      unsubRef.current = undefined;
    };
  }, [id, mode]);

  const lastEvents = useMemo(() => events.slice(-20), [events]);
  const scoreboardSource = meta?.score ?? matchTimeline?.score ?? fixture?.score ?? null;
  const scoreboardLabel = scoreboardSource
    ? 'h' in scoreboardSource
      ? `${scoreboardSource.h} - ${scoreboardSource.a}`
      : `${scoreboardSource.home} - ${scoreboardSource.away}`
    : null;
  const canViewVideo = Boolean(leagueId && fixture?.video?.uploaded);
  const handleOpenVideo = () => {
    if (!leagueId || !id) return;
    navigate(
      `/match-video?leagueId=${encodeURIComponent(leagueId)}&matchId=${encodeURIComponent(id)}`,
    );
  };
  const timelineCard =
    matchTimeline && matchTimeline.goalTimeline && matchTimeline.goalTimeline.length ? (
      <Card className="p-3">
        <div className="mb-2 text-sm text-muted-foreground">Goller</div>
        <div className="space-y-1">
          {matchTimeline.goalTimeline.map((goal, idx) => (
            <div
              key={`${goal.minute}-${goal.team}-${idx}`}
              className="flex items-center justify-between text-sm font-medium"
            >
              <span>{goal.minute}'</span>
              <span className="text-left">
                {goal.team === 'home' ? 'Ev' : 'Deplasman'}
                {goal.description ? ` - ${goal.description}` : ''}
              </span>
              <span>
                {goal.homeScore}-{goal.awayScore}
              </span>
            </div>
          ))}
        </div>
      </Card>
    ) : null;

  if (mode === 'loading') {
    return <div className="p-4">Yukleniyor...</div>;
  }

  if (mode === 'not-found') {
    return <div className="p-4">Mac bulunamadi.</div>;
  }

  if (mode === 'replay' && replayUrl) {
    return (
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BackButton />
            <h1 className="text-xl font-bold">Mac Kaydi</h1>
          </div>
          {canViewVideo ? (
            <Button variant="outline" size="sm" onClick={handleOpenVideo}>
              Video izle
            </Button>
          ) : null}
        </div>
        {scoreboardLabel ? (
          <div className="text-sm font-semibold text-muted-foreground">Skor: {scoreboardLabel}</div>
        ) : null}
        {timelineCard}
        <MatchReplayView matchId={id!} replayUrl={replayUrl} />
      </div>
    );
  }

  if (mode === 'gated' && fixture) {
    return (
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <BackButton />
          <h1 className="text-xl font-bold">Canli Mac</h1>
        </div>
        {scoreboardLabel ? (
          <div className="text-sm font-semibold text-muted-foreground">Skor: {scoreboardLabel}</div>
        ) : null}
        <Card className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-amber-500/10 p-2 text-amber-500">
              <Shield className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <div className="text-lg font-semibold">Canli maca girmek icin reklam gerekli</div>
              <p className="text-sm text-muted-foreground">
                Reklam tamamlanip dogrulanmadan canli feed acilmiyor.
              </p>
              {gateExpiresAt ? (
                <p className="text-xs text-muted-foreground">
                  Aktif erisim bitisi: {new Date(gateExpiresAt).toLocaleString('tr-TR')}
                </p>
              ) : null}
            </div>
          </div>
          <Button onClick={() => void unlockLiveView()} disabled={gateLoading}>
            {gateLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Reklami izle ve maca gir
          </Button>
        </Card>
        {timelineCard}
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <h1 className="text-xl font-bold">Canli Mac</h1>
        </div>
        {canViewVideo ? (
          <Button variant="outline" size="sm" onClick={handleOpenVideo}>
            Video izle
          </Button>
        ) : null}
      </div>
      {scoreboardLabel ? (
        <div className="text-sm font-semibold text-muted-foreground">Skor: {scoreboardLabel}</div>
      ) : null}
      {timelineCard}
      <Card className="p-3">
        <div className="mb-2 text-sm text-muted-foreground">Son olaylar</div>
        <div className="space-y-1">
          {lastEvents.map((event, index) => (
            <div key={index} className="rounded bg-muted/40 px-2 py-1 font-mono text-sm">
              <span className="opacity-60">{event.seq}</span> -{' '}
              <b>{(event as { type?: string; eventType?: string }).type || (event as { type?: string; eventType?: string }).eventType}</b>
              {event.payload ? ` ${JSON.stringify(event.payload)}` : ''}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Shield, Loader2, Radio } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/LanguageContext';
import { PagesHeader } from '@/components/layout/PagesHeader';
import { Button } from '@/components/ui/button';
import {
  ensureFixturesForLeague,
  getFixturesForTeamSlotAware,
  getLeagueTeams,
  getMyLeagueId,
} from '@/services/leagues';
import {
  isMatchControlConfigured,
  getMatchStatus,
  requestJoinTicket,
  waitForMatchReady,
} from '@/services/matchControl';
import { unityBridge } from '@/services/unityBridge';
import type { Fixture } from '@/types';
import { toast } from 'sonner';
import {
  isFixtureEffectivelyRunning,
  isFixtureLiveJoinable,
  LIVE_JOINABLE_STATES,
  normalizeFixtureStatus,
  resolveEffectiveFixtureLiveState,
} from '@/lib/fixtureLive';
import {
  ensureMatchEntryAccess,
  getMatchEntryAccessOutcomeMessage,
} from '@/services/matchEntryAccess';

interface DisplayFixture extends Fixture {
  opponent: string;
  opponentId: string;
  opponentLogo?: string;
  home: boolean;
  competitionName?: string;
}

function resolveEffectiveLiveState(fixture: DisplayFixture): string {
  return resolveEffectiveFixtureLiveState(fixture);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: string }).message;
    if (message && message.trim()) {
      const trimmed = message.trim();
      try {
        const parsed = JSON.parse(trimmed) as { error?: string };
        const code = String(parsed?.error || '').trim().toLowerCase();
        if (code === 'unauthorized' || code === 'league_match_join_forbidden') {
          return fallback;
        }
      } catch {
        return trimmed;
      }
      return trimmed;
    }
  }
  return fallback;
}

function getLiveStateKey(
  fixture: DisplayFixture,
): 'live' | 'preparing' | 'finished' | 'error' | null {
  const state = resolveEffectiveLiveState(fixture);
  if (!state) return null;
  if (state === 'running') return 'live';
  if (state === 'server_started' || state === 'starting' || state === 'warm') {
    return 'preparing';
  }
  if (state === 'ended') return 'finished';
  if (state === 'failed' || state === 'prepare_failed' || state === 'kickoff_failed') {
    return 'error';
  }
  return null;
}

function isLiveJoinable(fixture: DisplayFixture): boolean {
  return isFixtureLiveJoinable(fixture);
}

export default function MyFixturesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, formatDate } = useTranslation();
  const [fixtures, setFixtures] = useState<DisplayFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningFixtureId, setJoiningFixtureId] = useState<string | null>(null);
  const leagueUnitySessionActiveRef = useRef(false);

  const matchControlReady = useMemo(() => isMatchControlConfigured(), []);
  const canLaunchNativeLeagueMatch = useMemo(
    () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
    [],
  );

  useEffect(() => {
    let removeListener: (() => Promise<void>) | null = null;
    let disposed = false;

    if (!canLaunchNativeLeagueMatch) {
      return () => {};
    }

    void unityBridge
      .onUnityEvent((event) => {
        if (disposed || !leagueUnitySessionActiveRef.current) {
          return;
        }

        const type = String(event?.type || '').trim().toLowerCase();
        if (type === 'closed' || type === 'connection_failed' || type === 'error') {
          leagueUnitySessionActiveRef.current = false;
          navigate('/');
        }
      })
      .then((remove) => {
        removeListener = remove;
      })
      .catch((error) => {
        console.warn('[MyFixturesPage] Unity event listener registration failed', error);
      });

    return () => {
      disposed = true;
      if (removeListener) {
        void removeListener();
      }
    };
  }, [canLaunchNativeLeagueMatch, navigate]);

  useEffect(() => {
    let alive = true;

    const load = async (options?: { silent?: boolean }) => {
      if (!user || !alive) return;
      if (!options?.silent) {
        setLoading(true);
      }

      try {
        const leagueId = await getMyLeagueId(user.id);
        if (!leagueId) {
          if (alive) {
            setFixtures([]);
            setLoading(false);
          }
          return;
        }

        await ensureFixturesForLeague(leagueId);

        const [list, teams] = await Promise.all([
          getFixturesForTeamSlotAware(leagueId, user.id),
          getLeagueTeams(leagueId),
        ]);

        const teamMap = new Map(teams.map((team) => [team.id, team]));

        const mapped: DisplayFixture[] = list.map((fixture) => {
          const home = fixture.homeTeamId === user.id;
          const opponentId = home ? fixture.awayTeamId : fixture.homeTeamId;
          const opponentTeam = teamMap.get(opponentId);
          return {
            ...fixture,
            opponent: opponentTeam?.name || t('common.rivalFallback'),
            opponentId,
            opponentLogo: opponentTeam?.logo,
            home,
            competitionName: t('fixtures.labels.competitionName'),
          };
        });

        mapped.sort((left, right) => left.date.getTime() - right.date.getTime());
        if (alive) {
          setFixtures(mapped);
        }
      } catch (error) {
        console.error('[MyFixturesPage] fixtures load failed', error);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void load();

    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, 30000);

    const handleFocus = () => {
      void load({ silent: true });
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [t, user]);

  const handleJoinLiveFixture = async (fixture: DisplayFixture) => {
    if (!user?.id) {
      toast.error(t('fixtures.errors.loginRequired'));
      return;
    }

    if (!matchControlReady) {
      toast.error(t('fixtures.errors.matchControlUnavailable'));
      return;
    }

    if (!fixture.live?.matchId) {
      toast.error(t('fixtures.errors.noLiveConnection'));
      return;
    }

    if (!isLiveJoinable(fixture)) {
      toast.error(t('fixtures.errors.noLongerJoinable'));
      return;
    }

    if (!canLaunchNativeLeagueMatch) {
      toast.error(t('fixtures.errors.androidOnly'));
      return;
    }

    setJoiningFixtureId(fixture.id);
    try {
      const access = await ensureMatchEntryAccess({
        userId: user.id,
        matchKind: 'league',
        targetId: fixture.id,
        fixtureId: fixture.id,
        matchId: fixture.live?.matchId || undefined,
        competitionType: fixture.competitionType,
        surface: 'fixtures',
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

      const status = await getMatchStatus(fixture.live.matchId);
      const latestState = normalizeFixtureStatus(status.state);

      if (!LIVE_JOINABLE_STATES.has(latestState)) {
        setFixtures((prev) =>
          prev.map((item) => {
            if (item.id !== fixture.id) return item;
            const nextStatus =
              latestState === 'ended'
                ? 'played'
                : latestState === 'failed' || latestState === 'released'
                  ? 'failed'
                  : item.status;
            return {
              ...item,
              status: nextStatus as DisplayFixture['status'],
              live: {
                ...(item.live || {}),
                state: latestState,
                serverIp: status.serverIp || item.live?.serverIp,
                serverPort: status.serverPort || item.live?.serverPort,
              },
            };
          }),
        );
        toast.error(t('fixtures.errors.noLongerJoinable'));
        return;
      }

      const ticket = await requestJoinTicket({
        matchId: fixture.live.matchId,
        userId: user.id,
        role: 'player',
      });
      const readyMatch = await waitForMatchReady(ticket.matchId, {
        timeoutMs: 90000,
        pollMs: 700,
      });

      leagueUnitySessionActiveRef.current = true;
      await unityBridge.launchMatchActivity(readyMatch.serverIp, readyMatch.serverPort, {
        matchId: readyMatch.matchId,
        joinTicket: ticket.joinTicket,
        homeId: fixture.homeTeamId,
        awayId: fixture.awayTeamId,
        mode: 'league',
        role: 'player',
      });

      toast.success(t('fixtures.toasts.joinStarted'));
    } catch (error) {
      leagueUnitySessionActiveRef.current = false;
      console.error('[MyFixturesPage] Live league join failed.', error);
      toast.error(
        getErrorMessage(error, t('fixtures.errors.unauthorized')) ||
          t('fixtures.errors.joinFailed'),
      );
    } finally {
      setJoiningFixtureId(null);
    }
  };

  const renderStatusIndicator = (fixture: DisplayFixture) => {
    if (fixture.status === 'played' && fixture.score) {
      const { home: homeScore, away: awayScore } = fixture.score;
      const myScore = fixture.home ? homeScore : awayScore;
      const opponentScore = fixture.home ? awayScore : homeScore;

      if (myScore > opponentScore) {
        return (
          <div className="h-3 w-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
        );
      }
      if (myScore < opponentScore) {
        return (
          <div className="h-3 w-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
        );
      }
      return (
        <div className="h-3 w-3 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]" />
      );
    }

    if (isFixtureEffectivelyRunning(fixture)) {
      return (
        <div className="h-3 w-3 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
      );
    }

    return <div className="h-3 w-3 rounded-full bg-slate-600" />;
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 font-sans text-slate-100 md:p-6 lg:p-8">
      <PagesHeader
        title={t('fixtures.page.title')}
        description={t('fixtures.page.description')}
      />

      <div className="relative mt-6 flex-1 rounded-[32px] border border-white/5 bg-[#13111c]/90 p-6 shadow-2xl backdrop-blur-sm md:p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-wide text-purple-200">
              {t('fixtures.page.scheduleTitle')}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {t('fixtures.page.scheduleDescription')}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate(-1)}
            className="text-slate-400 hover:bg-white/5 hover:text-white"
          >
            {t('fixtures.page.back')}
          </Button>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="py-10 text-center text-slate-500">{t('fixtures.page.loading')}</div>
          ) : fixtures.length === 0 ? (
            <div className="py-10 text-center text-slate-500">{t('fixtures.page.empty')}</div>
          ) : (
            fixtures.map((fixture) => {
              const liveStateKey = getLiveStateKey(fixture);
              const liveLabel = liveStateKey ? t(`fixtures.labels.${liveStateKey}`) : null;
              const joinable = isLiveJoinable(fixture);
              const joining = joiningFixtureId === fixture.id;
              const myTeamName = user?.teamName || t('common.teamFallback');

              return (
                <div
                  key={fixture.id}
                  className="group flex flex-col gap-4 rounded-2xl border border-white/5 bg-[#1a1725] p-4 transition-all duration-300 hover:border-purple-500/30 hover:bg-[#201c2d] md:flex-row md:items-center md:justify-between"
                >
                  <div className="w-full text-xs font-semibold tracking-wider text-slate-400 md:w-32">
                    {formatDate(fixture.date, {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </div>

                  <div className="flex w-full flex-1 items-center justify-center gap-8 md:justify-start md:gap-12">
                    <div className="flex w-1/3 items-center justify-end gap-3 md:justify-start">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-800">
                        {fixture.home ? (
                          user?.teamLogo ? (
                            <img
                              src={user.teamLogo}
                              alt={myTeamName}
                              className="h-full w-full rounded-md object-cover"
                            />
                          ) : (
                            <Shield size={12} className="text-indigo-400" />
                          )
                        ) : fixture.opponentLogo ? (
                          <img
                            src={fixture.opponentLogo}
                            alt={fixture.opponent}
                            className="h-full w-full rounded-md object-cover"
                          />
                        ) : (
                          <Shield size={12} className="text-slate-500" />
                        )}
                      </div>
                      <span
                        className={`truncate text-sm font-bold ${fixture.home ? 'text-white' : 'text-slate-400'}`}
                      >
                        {fixture.home ? myTeamName : fixture.opponent}
                      </span>
                    </div>

                    <div className="flex w-1/3 items-center gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-800">
                        {!fixture.home ? (
                          user?.teamLogo ? (
                            <img
                              src={user.teamLogo}
                              alt={myTeamName}
                              className="h-full w-full rounded-md object-cover"
                            />
                          ) : (
                            <Shield size={12} className="text-indigo-400" />
                          )
                        ) : fixture.opponentLogo ? (
                          <img
                            src={fixture.opponentLogo}
                            alt={fixture.opponent}
                            className="h-full w-full rounded-md object-cover"
                          />
                        ) : (
                          <Shield size={12} className="text-slate-500" />
                        )}
                      </div>
                      <span
                        className={`truncate text-sm font-bold ${!fixture.home ? 'text-white' : 'text-slate-400'}`}
                      >
                        {!fixture.home ? myTeamName : fixture.opponent}
                      </span>
                    </div>
                  </div>

                  <div className="flex w-full flex-col gap-3 md:w-auto md:items-end">
                    <div className="flex items-center justify-between gap-6 md:justify-end">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        {fixture.competitionName}
                      </span>

                      <div className="flex min-w-[80px] items-center justify-end gap-3">
                        {renderStatusIndicator(fixture)}
                        <span
                          className={`text-lg font-black ${fixture.status === 'played' ? 'text-white' : 'text-slate-500'}`}
                        >
                          {fixture.status === 'played' && fixture.score
                            ? `${fixture.score.home} - ${fixture.score.away}`
                            : formatDate(fixture.date, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 md:justify-end">
                      {liveLabel ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-bold tracking-[0.2em] ${
                            liveStateKey === 'live'
                              ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200'
                              : liveStateKey === 'preparing'
                                ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
                                : liveStateKey === 'error'
                                  ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                                  : 'border-white/10 bg-white/5 text-slate-300'
                          }`}
                        >
                          <Radio className="h-3.5 w-3.5" />
                          {liveLabel}
                        </span>
                      ) : null}

                      {isFixtureEffectivelyRunning(fixture) && !liveLabel ? (
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                          {t('fixtures.labels.currentlyPlaying')}
                        </span>
                      ) : null}

                      {joinable ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleJoinLiveFixture(fixture)}
                          disabled={joining || !matchControlReady}
                          className="bg-cyan-500 font-bold text-slate-950 hover:bg-cyan-400"
                        >
                          {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {t('fixtures.labels.watch')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

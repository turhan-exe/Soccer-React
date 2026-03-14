import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Shield, Loader2, Radio } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
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

interface DisplayFixture extends Fixture {
  opponent: string;
  opponentId: string;
  opponentLogo?: string;
  home: boolean;
  competitionName?: string;
}

const LIVE_JOINABLE_STATES = new Set(['server_started', 'running']);

function normalizeStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function resolveEffectiveLiveState(fixture: DisplayFixture): string {
  const fixtureStatus = normalizeStatus(fixture.status);
  const liveState = normalizeStatus(fixture.live?.state);

  // Played fixtures can keep stale live snapshots; UI must treat them as ended.
  if (fixtureStatus === 'played') return 'ended';
  if (fixtureStatus === 'failed' && LIVE_JOINABLE_STATES.has(liveState)) return 'failed';
  return liveState;
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
          return 'Canli maca baglanti yetkin yok veya mac kapanmis.';
        }
      } catch {
        // Non-JSON message, use original text.
      }
      return message;
    }
  }
  return fallback;
}

function getLiveStateLabel(fixture: DisplayFixture): string | null {
  const state = resolveEffectiveLiveState(fixture);
  if (!state) return null;
  if (state === 'running') return 'CANLI';
  if (state === 'server_started' || state === 'starting' || state === 'warm') return 'HAZIRLANIYOR';
  if (state === 'ended') return 'BİTTİ';
  if (state === 'failed' || state === 'prepare_failed' || state === 'kickoff_failed') return 'HATA';
  return state.toUpperCase();
}

function isLiveJoinable(fixture: DisplayFixture): boolean {
  const matchId = String(fixture.live?.matchId || '').trim();
  const fixtureStatus = normalizeStatus(fixture.status);
  const state = resolveEffectiveLiveState(fixture);
  if (!matchId) return false;
  if (fixtureStatus !== 'running') return false;
  if (fixtureStatus === 'played' || fixtureStatus === 'failed') return false;
  return LIVE_JOINABLE_STATES.has(state);
}

export default function MyFixturesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
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
            opponent: opponentTeam?.name || 'Rakip',
            opponentId,
            opponentLogo: opponentTeam?.logo,
            home,
            competitionName: 'Süperlig',
          };
        });

        mapped.sort((a, b) => a.date.getTime() - b.date.getTime());
        if (alive) {
          setFixtures(mapped);
        }
      } catch (error) {
        console.error('Fikstür yüklenirken hata:', error);
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
  }, [user]);

  const handleJoinLiveFixture = async (fixture: DisplayFixture) => {
    if (!user?.id) {
      toast.error('Canlı maça bağlanmak için giriş yapmalısın.');
      return;
    }

    if (!matchControlReady) {
      toast.error('Match Control API ayarlı değil.');
      return;
    }

    if (!fixture.live?.matchId) {
      toast.error('Bu maç için canlı bağlantı bulunamadı.');
      return;
    }
    if (!isLiveJoinable(fixture)) {
      toast.error('Bu maç artık canlı bağlantıya açık değil.');
      return;
    }

    if (!canLaunchNativeLeagueMatch) {
      toast.error('Canlı lig maçı şu anda yalnızca Android uygulamada açılabiliyor.');
      return;
    }

    setJoiningFixtureId(fixture.id);
    try {
      const status = await getMatchStatus(fixture.live.matchId);
      const latestState = normalizeStatus(status.state);
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
        toast.error('Bu mac canli baglantiya acik degil.');
        return;
      }

      const ticket = await requestJoinTicket({
        matchId: fixture.live.matchId,
        userId: user.id,
        role: 'player',
      });
      const readyMatch = await waitForMatchReady(ticket.matchId, {
        timeoutMs: 35000,
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

      toast.success('Canlı maç bağlantısı başlatıldı.');
    } catch (error) {
      leagueUnitySessionActiveRef.current = false;
      console.error('[MyFixturesPage] Live league join failed.', error);
      toast.error(getErrorMessage(error, 'Canlı maça bağlanılamadı.'));
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
        return <div className="h-3 w-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />;
      }
      if (myScore < opponentScore) {
        return <div className="h-3 w-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />;
      }
      return <div className="h-3 w-3 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]" />;
    }

    if (fixture.status === 'running') {
      return <div className="h-3 w-3 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" />;
    }

    return <div className="h-3 w-3 rounded-full bg-slate-600" />;
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 font-sans text-slate-100 md:p-6 lg:p-8">
      <PagesHeader
        title="Fikstür"
        description="Sezonluk maç programı, canlı durumlar ve sonuçlar."
      />

      <div className="relative mt-6 flex-1 rounded-[32px] border border-white/5 bg-[#13111c]/90 p-6 shadow-2xl backdrop-blur-sm md:p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-wide text-purple-200">Fikstür Programı</h2>
            <p className="mt-1 text-xs text-slate-500">
              Canlı durumdaki maçlar için Android uygulamadan doğrudan maça bağlanabilirsin.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate(-1)}
            className="text-slate-400 hover:bg-white/5 hover:text-white"
          >
            Geri
          </Button>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="py-10 text-center text-slate-500">Yükleniyor...</div>
          ) : fixtures.length === 0 ? (
            <div className="py-10 text-center text-slate-500">Henüz fikstür oluşturulmamış.</div>
          ) : (
            fixtures.map((fixture) => {
              const liveLabel = getLiveStateLabel(fixture);
              const joinable = isLiveJoinable(fixture);
              const joining = joiningFixtureId === fixture.id;

              return (
                <div
                  key={fixture.id}
                  className="group flex flex-col gap-4 rounded-2xl border border-white/5 bg-[#1a1725] p-4 transition-all duration-300 hover:border-purple-500/30 hover:bg-[#201c2d] md:flex-row md:items-center md:justify-between"
                >
                  <div className="w-full text-xs font-semibold tracking-wider text-slate-400 md:w-32">
                    {format(fixture.date, 'dd.MM.yyyy')}
                  </div>

                  <div className="flex w-full flex-1 items-center justify-center gap-8 md:justify-start md:gap-12">
                    <div className="flex w-1/3 items-center justify-end gap-3 md:justify-start">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-800">
                        {fixture.home ? (
                          user?.teamLogo ? (
                            <img
                              src={user.teamLogo}
                              alt={user.teamName || 'Takımım'}
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
                      <span className={`truncate text-sm font-bold ${fixture.home ? 'text-white' : 'text-slate-400'}`}>
                        {fixture.home ? user?.teamName || 'Takımım' : fixture.opponent}
                      </span>
                    </div>

                    <div className="flex w-1/3 items-center gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-800">
                        {!fixture.home ? (
                          user?.teamLogo ? (
                            <img
                              src={user.teamLogo}
                              alt={user.teamName || 'Takımım'}
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
                      <span className={`truncate text-sm font-bold ${!fixture.home ? 'text-white' : 'text-slate-400'}`}>
                        {!fixture.home ? user?.teamName || 'Takımım' : fixture.opponent}
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
                        <span className={`text-lg font-black ${fixture.status === 'played' ? 'text-white' : 'text-slate-500'}`}>
                          {fixture.status === 'played' && fixture.score
                            ? `${fixture.score.home} - ${fixture.score.away}`
                            : format(fixture.date, 'HH:mm')}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 md:justify-end">
                      {liveLabel ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-bold tracking-[0.2em] ${
                            liveLabel === 'CANLI'
                              ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200'
                              : liveLabel === 'HAZIRLANIYOR'
                                ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
                                : liveLabel === 'HATA'
                                  ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                                  : 'border-white/10 bg-white/5 text-slate-300'
                          }`}
                        >
                          <Radio className="h-3.5 w-3.5" />
                          {liveLabel}
                        </span>
                      ) : null}

                      {fixture.status === 'running' && !liveLabel ? (
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                          Maç oynanıyor
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
                          İzle
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Wifi, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { unityBridge } from '@/services/unityBridge';
import { getTeam } from '@/services/team';
import {
  acceptFriendlyRequest,
  buildUnityRuntimeTeamPayload,
  createFriendlyRequest,
  getMatchStatus,
  isMatchControlConfigured,
  listFriendlyMatchHistory,
  listFriendlyRequests,
  requestJoinTicket,
  waitForMatchReady,
  type FriendlyMatchHistoryItem,
  type FriendlyRequestListItem,
} from '@/services/matchControl';

export default function FriendlyMatchPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const [ip, setIp] = useState('127.0.0.1');
  const [port, setPort] = useState('7777');
  const [homeId, setHomeId] = useState('team_home');
  const [awayId, setAwayId] = useState('team_away');

  const [requestId, setRequestId] = useState('');
  const [matchId, setMatchId] = useState('');
  const [requestState, setRequestState] = useState<'idle' | 'pending' | 'accepted' | 'expired' | 'running'>('idle');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [apiConnectionState, setApiConnectionState] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [apiConnectionError, setApiConnectionError] = useState('');

  const [incomingRequests, setIncomingRequests] = useState<FriendlyRequestListItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendlyRequestListItem[]>([]);
  const [matchHistory, setMatchHistory] = useState<FriendlyMatchHistoryItem[]>([]);
  const [opponentUserId, setOpponentUserId] = useState('');
  const [opponentName, setOpponentName] = useState('');
  const pollFailureCountRef = useRef(0);
  const hasLoggedConnectionErrorRef = useRef(false);
  const delayedHistoryRefreshTimersRef = useRef<number[]>([]);

  const apiEnabled = useMemo(() => isMatchControlConfigured(), []);
  const canRunApiFlow = apiEnabled && !!user?.id;

  useEffect(() => {
    const queryOpponentUserId = (searchParams.get('opponentUserId') || '').trim();
    const queryOpponentName = (searchParams.get('opponentName') || '').trim();

    if (queryOpponentUserId) {
      setOpponentUserId(queryOpponentUserId);
      setAwayId(queryOpponentUserId);
    }

    if (queryOpponentName) {
      setOpponentName(queryOpponentName);
      setAwayId((prev) => (prev === 'team_away' || prev === queryOpponentUserId ? queryOpponentName : prev));
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    const loadMyTeamName = async () => {
      if (!user?.id) return;

      try {
        const team = await getTeam(user.id);
        const preferred = (team?.name || user.teamName || user.id || '').trim();
        if (!cancelled && preferred) {
          setHomeId(preferred);
        }
      } catch {
        const fallback = (user.teamName || user.id || '').trim();
        if (!cancelled && fallback) {
          setHomeId(fallback);
        }
      }
    };

    void loadMyTeamName();

    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.teamName]);

  useEffect(() => {
    let cancelled = false;

    const loadOpponentTeamName = async () => {
      if (!opponentUserId) return;

      try {
        const team = await getTeam(opponentUserId);
        const preferred = (team?.name || opponentName || opponentUserId).trim();
        if (!cancelled && preferred) {
          setAwayId(preferred);
          if (!opponentName && team?.name) {
            setOpponentName(team.name);
          }
        }
      } catch {
        const fallback = (opponentName || opponentUserId).trim();
        if (!cancelled && fallback) {
          setAwayId(fallback);
        }
      }
    };

    void loadOpponentTeamName();

    return () => {
      cancelled = true;
    };
  }, [opponentUserId, opponentName]);

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error && typeof error === 'object' && 'message' in error) {
      const candidate = (error as { message?: string }).message;
      if (candidate && candidate.trim().length > 0) {
        return candidate;
      }
    }
    return fallback;
  };

  const launchUnity = async (serverIp: string, serverPort: number, joinTicket?: string, activeMatchId?: string) => {
    await unityBridge.launchMatchActivity(serverIp, serverPort, {
      homeId,
      awayId,
      matchId: activeMatchId,
      joinTicket,
      mode: 'friendly',
      role: 'player',
    });
  };

  const syncLists = useCallback(async () => {
    if (!canRunApiFlow || !user?.id) {
      return;
    }

    const items = await listFriendlyRequests(user.id);
    const incoming = items.filter(
      (item) => item.status === 'pending' && item.opponentUserId === user.id && item.requesterUserId !== user.id,
    );
    const outgoing = items.filter(
      (item) => item.requesterUserId === user.id && (item.status === 'pending' || item.status === 'accepted'),
    );

    setIncomingRequests(incoming);
    setOutgoingRequests(outgoing);

    if (!requestId && opponentUserId) {
      const pendingForOpponent = outgoing.find(
        (item) => item.status === 'pending' && item.opponentUserId === opponentUserId,
      );
      if (pendingForOpponent?.requestId) {
        setRequestId(pendingForOpponent.requestId);
        setRequestState('pending');
      }
    }

    if (requestId) {
      const tracked = items.find((item) => item.requestId === requestId);
      if (tracked?.status === 'accepted' && tracked.match) {
        setMatchId(tracked.match.matchId);
        setIp(tracked.match.serverIp);
        setPort(String(tracked.match.serverPort));
        setRequestState('accepted');
      } else if (tracked?.status === 'pending') {
        setRequestState('pending');
      } else if (tracked?.status === 'expired') {
        setRequestState('expired');
      }
    }
  }, [canRunApiFlow, user?.id, requestId, opponentUserId]);

  const refreshHistory = useCallback(async () => {
    if (!canRunApiFlow || !user?.id) {
      setMatchHistory([]);
      return;
    }

    try {
      const items = await listFriendlyMatchHistory({
        userId: user.id,
        opponentUserId: opponentUserId || undefined,
        limit: 20,
      });
      setMatchHistory(items);
    } catch (error) {
      console.warn('[FriendlyMatchPage] Failed to load friendly history.', error);
    }
  }, [canRunApiFlow, opponentUserId, user?.id]);

  const scheduleDelayedHistoryRefreshes = useCallback(() => {
    delayedHistoryRefreshTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    delayedHistoryRefreshTimersRef.current = [2000, 5000].map((delayMs) =>
      window.setTimeout(() => {
        void refreshHistory();
      }, delayMs),
    );
  }, [refreshHistory]);

  useEffect(() => {
    let removeListener: (() => Promise<void>) | null = null;
    let disposed = false;

    void unityBridge.onUnityEvent((event) => {
      if (disposed) return;

      const type = String(event?.type || '').toLowerCase();
      if (type === 'error' || type === 'connection_failed') {
        toast.error(event?.message || 'Unity baglanti hatasi.');
        return;
      }

      if (type === 'match_ended') {
        toast.info('Mac sona erdi.');
        void refreshHistory();
        scheduleDelayedHistoryRefreshes();
        return;
      }

      if (type === 'closed') {
        toast.info('Unity ekrani kapatildi.');
        void syncLists();
        void refreshHistory();
        scheduleDelayedHistoryRefreshes();
      }
    }).then((remove) => {
      removeListener = remove;
    }).catch((error) => {
      console.warn('[FriendlyMatchPage] Unity event listener registration failed', error);
    });

    return () => {
      disposed = true;
      if (removeListener) {
        void removeListener();
      }
      delayedHistoryRefreshTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      delayedHistoryRefreshTimersRef.current = [];
    };
  }, [refreshHistory, scheduleDelayedHistoryRefreshes, syncLists]);

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      void syncLists();
      void refreshHistory();
      scheduleDelayedHistoryRefreshes();
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [refreshHistory, scheduleDelayedHistoryRefreshes, syncLists]);

  useEffect(() => {
    if (!canRunApiFlow || !user?.id) {
      setApiConnectionState('unknown');
      return;
    }

    let alive = true;
    let timer: number | undefined;

    const scheduleNext = () => {
      const failures = pollFailureCountRef.current;
      const delayMs =
        failures <= 0 ? 3000 : Math.min(30000, 3000 * Math.pow(2, Math.min(failures - 1, 3)));
      timer = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      try {
        await syncLists();
        pollFailureCountRef.current = 0;
        hasLoggedConnectionErrorRef.current = false;
        if (alive) {
          setApiConnectionState('online');
          setApiConnectionError('');
        }
      } catch (error: unknown) {
        pollFailureCountRef.current += 1;
        if (alive) {
          setApiConnectionState('offline');
          setApiConnectionError(getErrorMessage(error, 'Match Control API baglantisi kurulamadi.'));
        }

        if (!hasLoggedConnectionErrorRef.current) {
          hasLoggedConnectionErrorRef.current = true;
          console.warn('[FriendlyMatchPage] Match Control API offline.', error);
        }
      } finally {
        if (alive) {
          scheduleNext();
        }
      }
    };

    void poll();

    return () => {
      alive = false;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [canRunApiFlow, user?.id, syncLists]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const handleManualConnect = async () => {
    toast.info(`Manual connect: ${homeId} vs ${awayId}`);
    try {
      await launchUnity(ip, Number.parseInt(port, 10) || 7777);
    } catch (error: unknown) {
      console.error(error);
      toast.error(getErrorMessage(error, 'Unity acilamadi.'));
    }
  };

  const handleCreateRequest = async () => {
    if (!canRunApiFlow || !user?.id) {
      toast.error('API flow icin giris yap ve VITE_MATCH_CONTROL_BASE_URL tanimla.');
      return;
    }

    setLoadingAction('create');
    try {
      const [homeTeam, awayTeam] = await Promise.all([
        getTeam(user.id).catch(() => null),
        opponentUserId ? getTeam(opponentUserId).catch(() => null) : Promise.resolve(null),
      ]);

      const result = await createFriendlyRequest({
        requesterUserId: user.id,
        opponentUserId: opponentUserId || undefined,
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeTeamPayload: buildUnityRuntimeTeamPayload(homeTeam),
        awayTeamPayload: buildUnityRuntimeTeamPayload(awayTeam),
      });
      setRequestId(result.requestId);
      setRequestState('pending');
      toast.success(`Dostluk istegi olusturuldu. RequestId: ${result.requestId}`);
      await syncLists();
      await refreshHistory();
    } catch (error: unknown) {
      console.error(error);
      toast.error(getErrorMessage(error, 'Istek olusturulamadi.'));
    } finally {
      setLoadingAction(null);
    }
  };

  const joinMatchById = async (targetMatchId: string) => {
    if (!canRunApiFlow || !user?.id) {
      toast.error('API flow icin giris yap ve VITE_MATCH_CONTROL_BASE_URL tanimla.');
      return;
    }

    if (!targetMatchId.trim()) {
      toast.error('Lutfen match id gir.');
      return;
    }

    setLoadingAction('join');
    try {
      const ticket = await requestJoinTicket({
        matchId: targetMatchId.trim(),
        userId: user.id,
        role: 'player',
      });
      const readyMatch = await waitForMatchReady(ticket.matchId, {
        timeoutMs: 35000,
        pollMs: 700,
      });

      setMatchId(readyMatch.matchId);
      setIp(readyMatch.serverIp);
      setPort(String(readyMatch.serverPort));

      await launchUnity(readyMatch.serverIp, readyMatch.serverPort, ticket.joinTicket, readyMatch.matchId);
      toast.success('Unity client baglantisi baslatildi.');
    } catch (error: unknown) {
      console.error(error);
      toast.error(getErrorMessage(error, 'Join ticket alinamadi.'));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAcceptByRequestId = async (targetRequestId: string) => {
    if (!canRunApiFlow || !user?.id) {
      toast.error('API flow icin giris yap ve VITE_MATCH_CONTROL_BASE_URL tanimla.');
      return;
    }

    if (!targetRequestId.trim()) {
      toast.error('Lutfen request id gir.');
      return;
    }

    setLoadingAction(`accept:${targetRequestId}`);
    try {
      const accepted = await acceptFriendlyRequest(targetRequestId.trim(), {
        acceptingUserId: user.id,
        role: 'player',
      });
      const readyMatch = await waitForMatchReady(accepted.matchId, {
        timeoutMs: 35000,
        pollMs: 700,
      });
      setRequestId(targetRequestId.trim());
      setMatchId(readyMatch.matchId);
      setRequestState('accepted');
      setIp(readyMatch.serverIp);
      setPort(String(readyMatch.serverPort));

      await launchUnity(
        readyMatch.serverIp,
        readyMatch.serverPort,
        accepted.joinTicket,
        readyMatch.matchId,
      );
      toast.success('Mac baslatildi ve Unity acildi.');
      await syncLists();
      await refreshHistory();
    } catch (error: unknown) {
      console.error(error);
      toast.error(getErrorMessage(error, 'Istek kabul edilemedi.'));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRefreshMatchState = async () => {
    if (!canRunApiFlow || !matchId.trim()) {
      return;
    }

    setLoadingAction('status');
    try {
      const status = await getMatchStatus(matchId.trim());
      setRequestState(status.state === 'running' ? 'running' : requestState);
      setIp(status.serverIp);
      setPort(String(status.serverPort));
      toast.info(`Match state: ${status.state}`);
    } catch (error: unknown) {
      console.error(error);
      toast.error(getErrorMessage(error, 'Match state alinamadi.'));
    } finally {
      setLoadingAction(null);
    }
  };

  const formatHistoryDate = (value: string | null | undefined) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString('tr-TR');
  };

  const getResultBadge = (value: FriendlyMatchHistoryItem['resultForUser']) => {
    switch (value) {
      case 'win':
        return { label: 'G', className: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30' };
      case 'loss':
        return { label: 'M', className: 'bg-rose-600/20 text-rose-300 border-rose-500/30' };
      default:
        return { label: 'B', className: 'bg-amber-600/20 text-amber-300 border-amber-500/30' };
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 flex flex-col items-center justify-center">
      <div className="absolute top-4 left-4">
        <Button variant="ghost" onClick={() => navigate(-1)} className="text-slate-400 hover:text-white">
          <ArrowLeft className="mr-2 h-4 w-4" /> Geri
        </Button>
      </div>

      <Card className="w-full max-w-3xl bg-slate-900 border-slate-800 shadow-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-emerald-400">
            <Wifi className="w-6 h-6" />
            Dostluk Maci (Hetzner Allocation)
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="text-xs text-slate-500 border border-slate-800 rounded p-3 space-y-1">
            <div>Current user: {user?.id || 'not logged in'}</div>
            <div>Flow mode: {apiEnabled ? 'API-first' : 'API disabled'}</div>
            <div>Request state: {requestState}</div>
            <div>API connection: {apiConnectionState}</div>
            {opponentUserId ? <div>Selected opponent: {opponentName || opponentUserId}</div> : null}
            {apiConnectionState === 'offline' ? (
              <div className="text-red-400">
                API offline. {apiConnectionError || 'match-control-api servisini calistir.'}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <Button
              onClick={() => void handleCreateRequest()}
              disabled={!canRunApiFlow || !opponentUserId.trim() || !!loadingAction}
              className="bg-emerald-600 hover:bg-emerald-500 font-bold"
            >
              {loadingAction === 'create' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Dostluk Maci Gonder
            </Button>

            <Button
              onClick={() => joinMatchById(matchId)}
              disabled={!canRunApiFlow || !matchId.trim() || !!loadingAction}
              className="bg-purple-600 hover:bg-purple-500 font-bold"
            >
              {loadingAction === 'join' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Match'e Katil (Join Ticket)
            </Button>

            <Button
              onClick={handleRefreshMatchState}
              disabled={!canRunApiFlow || !matchId.trim() || !!loadingAction}
              className="bg-slate-700 hover:bg-slate-600 font-bold"
            >
              {loadingAction === 'status' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Match Durumu Yenile
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-slate-800 rounded p-3 space-y-2">
              <div className="text-sm font-semibold text-slate-300">Gelen Dostluk Maci Isleri</div>
              {incomingRequests.length === 0 ? (
                <div className="text-xs text-slate-500">Bekleyen gelen istek yok.</div>
              ) : (
                incomingRequests.map((item) => (
                  <div key={item.requestId} className="rounded border border-slate-700 p-2 text-xs text-slate-300 space-y-1">
                    <div>Request: {item.requestId}</div>
                    <div>From: {item.requesterUserId}</div>
                    <Button
                      size="sm"
                      onClick={() => void handleAcceptByRequestId(item.requestId)}
                      disabled={!!loadingAction}
                      className="mt-1 bg-emerald-600 hover:bg-emerald-500"
                    >
                      Kabul Et + Unity Ac
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="border border-slate-800 rounded p-3 space-y-2">
              <div className="text-sm font-semibold text-slate-300">Gonderdigim Istekler</div>
              {outgoingRequests.length === 0 ? (
                <div className="text-xs text-slate-500">Gonderilmis istek yok.</div>
              ) : (
                outgoingRequests.map((item) => (
                  <div key={item.requestId} className="rounded border border-slate-700 p-2 text-xs text-slate-300 space-y-1">
                    <div>Request: {item.requestId}</div>
                    <div>Status: {item.status}</div>
                    <div>To: {item.opponentUserId || '-'}</div>
                    {item.match?.matchId ? (
                      <Button
                        size="sm"
                        onClick={() => void joinMatchById(item.match?.matchId || '')}
                        disabled={!!loadingAction}
                        className="mt-1 bg-purple-600 hover:bg-purple-500"
                      >
                        Match'e Katil
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border border-slate-800 rounded p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-300">Gecmis Maclar</div>
              {opponentUserId ? (
                <div className="text-xs text-slate-500">
                  Rakip: {opponentName || opponentUserId}
                </div>
              ) : (
                <div className="text-xs text-slate-500">Rakip secilince gecmis maclar listelenir.</div>
              )}
            </div>

            {!opponentUserId ? (
              <div className="text-xs text-slate-500">Gecmis maclari gormek icin bir rakip sec.</div>
            ) : matchHistory.length === 0 ? (
              <div className="text-xs text-slate-500">Bu rakiple kayitli tamamlanmis mac yok.</div>
            ) : (
              <div className="space-y-2">
                {matchHistory.map((item) => {
                  const badge = getResultBadge(item.resultForUser);
                  return (
                    <div
                      key={item.matchId}
                      className="rounded border border-slate-700 p-3 text-xs text-slate-300 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-slate-400">{formatHistoryDate(item.playedAt)}</div>
                        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-white">
                        {item.homeTeamName} {item.homeScore} - {item.awayScore} {item.awayTeamName}
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                        <div>MatchId: {item.matchId}</div>
                        <div className="flex items-center gap-2">
                          {item.videoAvailable && item.videoWatchUrl ? (
                            <Button
                              size="sm"
                              type="button"
                              onClick={() => window.open(item.videoWatchUrl || '', '_blank', 'noopener,noreferrer')}
                              className="bg-blue-600 hover:bg-blue-500"
                            >
                              Videoyu Izle
                            </Button>
                          ) : item.videoStatus === 'processing' ? (
                            <span className="text-blue-300">Video Hazirlaniyor</span>
                          ) : item.videoStatus === 'failed' ? (
                            <span className="text-rose-300">Video hazirlanamadi</span>
                          ) : (
                            <span className="text-slate-500">Video yok</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

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
  getFriendlyRequestStatus,
  getMatchControlHealth,
  getMatchStatus,
  getFriendlyMatchReadyStates,
  isMatchControlConfigured,
  listFriendlyMatchHistory,
  listFriendlyRequests,
  requestJoinTicket,
  waitForMatchReady,
  type FriendlyMatchHistoryItem,
  type FriendlyRequestListItem,
} from '@/services/matchControl';

function normalizeFriendlyAcceptMode(value: unknown): 'manual' | 'offline_auto' | 'unknown' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'offline_auto') return 'offline_auto';
  if (normalized === 'manual') return 'manual';
  return 'unknown';
}

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
  const [requestAcceptMode, setRequestAcceptMode] = useState<'manual' | 'offline_auto' | 'unknown'>('unknown');
  const [autoAcceptAt, setAutoAcceptAt] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [unityLaunchOverlay, setUnityLaunchOverlay] = useState<{
    title: string;
    detail: string;
    startedAt: number;
  } | null>(null);
  const [unityLaunchElapsedSeconds, setUnityLaunchElapsedSeconds] = useState(0);
  const [apiConnectionState, setApiConnectionState] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [apiConnectionError, setApiConnectionError] = useState('');

  const [incomingRequests, setIncomingRequests] = useState<FriendlyRequestListItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendlyRequestListItem[]>([]);
  const [matchHistory, setMatchHistory] = useState<FriendlyMatchHistoryItem[]>([]);
  const [opponentUserId, setOpponentUserId] = useState('');
  const [opponentName, setOpponentName] = useState('');
  const [autoAcceptCountdownSeconds, setAutoAcceptCountdownSeconds] = useState<number | null>(null);
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

  const showUnityLaunchOverlay = useCallback((title: string, detail: string) => {
    setUnityLaunchOverlay((current) => ({
      title,
      detail,
      startedAt: current?.startedAt ?? Date.now(),
    }));
  }, []);

  const hideUnityLaunchOverlay = useCallback(() => {
    setUnityLaunchOverlay(null);
    setUnityLaunchElapsedSeconds(0);
  }, []);

  useEffect(() => {
    if (!unityLaunchOverlay) {
      return;
    }

    setUnityLaunchElapsedSeconds(Math.max(0, Math.floor((Date.now() - unityLaunchOverlay.startedAt) / 1000)));
    const timer = window.setInterval(() => {
      setUnityLaunchElapsedSeconds(Math.max(0, Math.floor((Date.now() - unityLaunchOverlay.startedAt) / 1000)));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [unityLaunchOverlay]);

  useEffect(() => {
    if (!autoAcceptAt) {
      setAutoAcceptCountdownSeconds(null);
      return;
    }

    const updateCountdown = () => {
      const remainingMs = new Date(autoAcceptAt).getTime() - Date.now();
      setAutoAcceptCountdownSeconds(Math.max(0, Math.ceil(remainingMs / 1000)));
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoAcceptAt]);

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

  const launchFriendlyMatchById = useCallback(async (targetMatchId: string) => {
    if (!canRunApiFlow || !user?.id) {
      toast.error('API flow icin giris yap ve VITE_MATCH_CONTROL_BASE_URL tanimla.');
      return;
    }

    showUnityLaunchOverlay('Mac baglantisi hazirlaniyor', 'Join ticket aliniyor ve mac sunucusunun hazir olmasi bekleniyor.');
    const ticket = await requestJoinTicket({
      matchId: targetMatchId.trim(),
      userId: user.id,
      role: 'player',
    });
    showUnityLaunchOverlay('Mac sunucusu hazirlaniyor', 'Sunucu running durumuna gelene kadar bekleniyor. Bu adim bazen 10-20 saniye surebilir.');
    const readyMatch = await waitForMatchReady(ticket.matchId, {
      timeoutMs: 90000,
      pollMs: 700,
      readyStates: getFriendlyMatchReadyStates(),
    });

    setMatchId(readyMatch.matchId);
    setIp(readyMatch.serverIp);
    setPort(String(readyMatch.serverPort));

    showUnityLaunchOverlay('Unity aciliyor', 'Unity ekrani acilana kadar bu sayfada kal. Uygulama birazdan Unity alanina gececek.');
    await launchUnity(readyMatch.serverIp, readyMatch.serverPort, ticket.joinTicket, readyMatch.matchId);
    toast.success('Unity client baglantisi baslatildi.');
  }, [canRunApiFlow, launchUnity, showUnityLaunchOverlay, user?.id]);

  const syncLists = useCallback(async () => {
    if (!canRunApiFlow || !user?.id) {
      return;
    }

    const items = await listFriendlyRequests(user.id);
    const incoming = items.filter(
      (item) =>
        item.status === 'pending' &&
        item.opponentUserId === user.id &&
        item.requesterUserId !== user.id &&
        normalizeFriendlyAcceptMode(item.acceptMode) !== 'offline_auto',
    );
    const outgoing = items.filter(
      (item) =>
        item.requesterUserId === user.id &&
        (item.status === 'pending' || item.status === 'accepted'),
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
        setRequestAcceptMode(normalizeFriendlyAcceptMode(tracked.acceptMode));
        setAutoAcceptAt(tracked.autoAcceptAt || null);
      } else if (tracked?.status === 'pending') {
        setRequestState('pending');
        setRequestAcceptMode(normalizeFriendlyAcceptMode(tracked.acceptMode));
        setAutoAcceptAt(tracked.autoAcceptAt || null);
      } else if (tracked?.status === 'expired') {
        setRequestState('expired');
        setRequestAcceptMode(normalizeFriendlyAcceptMode(tracked.acceptMode));
        setAutoAcceptAt(null);
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

  const waitForOfflineAutoAcceptAndLaunch = useCallback(async (targetRequestId: string) => {
    let deadline = Date.now() + 45_000;

    while (Date.now() < deadline) {
      const current = await getFriendlyRequestStatus(targetRequestId);
      const currentState = String(current.status || '').trim().toLowerCase();
      const expiresAtMs = current.expiresAt ? new Date(current.expiresAt).getTime() : Number.NaN;
      if (Number.isFinite(expiresAtMs)) {
        deadline = Math.max(deadline, Math.min(expiresAtMs + 1500, Date.now() + 115_000));
      }
      setRequestAcceptMode(normalizeFriendlyAcceptMode(current.acceptMode));
      setAutoAcceptAt(current.autoAcceptAt || null);

      if (currentState === 'accepted' && current.match?.matchId) {
        setRequestState('accepted');
        setMatchId(current.match.matchId);
        setIp(current.match.serverIp);
        setPort(String(current.match.serverPort));
        await syncLists();
        await refreshHistory();
        await launchFriendlyMatchById(current.match.matchId);
        return;
      }

      if (currentState === 'expired') {
        setRequestState('expired');
        throw new Error('Offline dostluk maci otomatik olarak baslatilamadi.');
      }

      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }

    throw new Error('Offline dostluk maci zamaninda hazir olmadi.');
  }, [launchFriendlyMatchById, refreshHistory, syncLists]);

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
        hideUnityLaunchOverlay();
        toast.error(event?.message || 'Unity baglanti hatasi.');
        return;
      }

      if (type === 'match_ended') {
        hideUnityLaunchOverlay();
        toast.info('Mac sona erdi.');
        void refreshHistory();
        scheduleDelayedHistoryRefreshes();
        return;
      }

      if (type === 'closed') {
        hideUnityLaunchOverlay();
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
  }, [hideUnityLaunchOverlay, refreshHistory, scheduleDelayedHistoryRefreshes, syncLists]);

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      if (!loadingAction) {
        hideUnityLaunchOverlay();
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
  }, [hideUnityLaunchOverlay, loadingAction, refreshHistory, scheduleDelayedHistoryRefreshes, syncLists]);

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
        const health = await getMatchControlHealth();
        if (!health?.ok) {
          throw new Error('Match Control API health check basarisiz.');
        }

        try {
          await syncLists();
        } catch (error) {
          console.warn('[FriendlyMatchPage] Request sync failed while API is online.', error);
        }

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
      setRequestAcceptMode(normalizeFriendlyAcceptMode(result.acceptMode));
      setAutoAcceptAt(result.autoAcceptAt || null);
      await syncLists();
      await refreshHistory();

      if (normalizeFriendlyAcceptMode(result.acceptMode) === 'offline_auto') {
        toast.success('Rakip offline. 3 saniye icinde mac otomatik hazirlanacak.');
        setLoadingAction('offline-auto');
        await waitForOfflineAutoAcceptAndLaunch(result.requestId);
      } else {
        toast.success(`Dostluk istegi olusturuldu. RequestId: ${result.requestId}`);
      }
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
      await launchFriendlyMatchById(targetMatchId);
    } catch (error: unknown) {
      hideUnityLaunchOverlay();
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
      showUnityLaunchOverlay('Istek kabul ediliyor', 'Dostluk maci istegi kabul edildi. Dedicated sunucu hazirlaniyor.');
      const accepted = await acceptFriendlyRequest(targetRequestId.trim(), {
        acceptingUserId: user.id,
        role: 'player',
      });
      setRequestId(targetRequestId.trim());
      setMatchId(accepted.matchId);
      setRequestState('accepted');
      setRequestAcceptMode('manual');
      setAutoAcceptAt(null);
      showUnityLaunchOverlay('Mac sunucusu hazirlaniyor', 'Mac durumu running olana kadar bekleniyor. Unity birazdan acilacak.');
      const readyMatch = await waitForMatchReady(accepted.matchId, {
        timeoutMs: 90000,
        pollMs: 700,
        readyStates: getFriendlyMatchReadyStates(),
      });
      setMatchId(readyMatch.matchId);
      setIp(readyMatch.serverIp);
      setPort(String(readyMatch.serverPort));

      showUnityLaunchOverlay('Unity aciliyor', 'Unity alani acilana kadar bu ekranda kal. Ekran degisimi genelde 10-20 saniye icinde olur.');
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
      hideUnityLaunchOverlay();
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
      {unityLaunchOverlay ? (
        <div className="fixed inset-0 z-50 bg-slate-950/92 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3 text-emerald-400">
              <Loader2 className="h-6 w-6 animate-spin" />
              <div className="text-lg font-semibold">{unityLaunchOverlay.title}</div>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-slate-200 leading-6">{unityLaunchOverlay.detail}</p>
              <p className="text-xs text-slate-400">Bekleme suresi: {unityLaunchElapsedSeconds} sn</p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-500" />
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
              Buton kaybolsa bile islem devam ediyor. Unity ekrani acilana kadar burada bekle.
            </div>
          </div>
        </div>
      ) : null}
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
            <div>Accept mode: {requestAcceptMode}</div>
            <div>API connection: {apiConnectionState}</div>
            {opponentUserId ? <div>Selected opponent: {opponentName || opponentUserId}</div> : null}
            {requestAcceptMode === 'offline_auto' && autoAcceptCountdownSeconds != null ? (
              <div className="text-amber-300">
                Rakip offline. Otomatik kabul geri sayimi: {autoAcceptCountdownSeconds} sn
              </div>
            ) : null}
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
                    <div>Accept mode: {item.acceptMode || 'manual'}</div>
                    <div>To: {item.opponentUserId || '-'}</div>
                    {normalizeFriendlyAcceptMode(item.acceptMode) === 'offline_auto' && item.autoAcceptAt ? (
                      <div className="text-amber-300">
                        Otomatik kabul zamani: {new Date(item.autoAcceptAt).toLocaleTimeString('tr-TR')}
                      </div>
                    ) : null}
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
                      <div className="text-xs text-slate-400">
                        <div>MatchId: {item.matchId}</div>
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

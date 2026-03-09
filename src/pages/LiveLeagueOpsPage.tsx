import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Server,
  ShieldAlert,
  Video,
} from 'lucide-react';
import { PagesHeader } from '@/components/layout/PagesHeader';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/services/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const TZ = 'Europe/Istanbul';
const ACTIVE_STATES = new Set(['warm', 'starting', 'server_started', 'running']);
const WARM_STATES = new Set(['warm', 'starting']);

type OpsFixture = {
  id: string;
  leagueId: string;
  status: string;
  date: Date | null;
  scoreText: string;
  liveState: string;
  nodeId: string | null;
  matchId: string | null;
  videoMissing: boolean;
  resultMissing: boolean;
  lastLifecycleAt: Date | null;
};

type NodeOccupancy = {
  nodeId: string;
  active: number;
  warm: number;
  running: number;
  failed: number;
  total: number;
};

type DashboardSnapshot = {
  heartbeat: Record<string, unknown> | null;
  fixtures: OpsFixture[];
  leagueCount: number;
  fetchedAt: Date;
};

function getTodayKey() {
  return formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value !== null) {
    if ('toDate' in value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
      const date = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if ('seconds' in value && typeof (value as { seconds?: number }).seconds === 'number') {
      const millis =
        ((value as { seconds: number; nanoseconds?: number }).seconds * 1000) +
        Math.floor(((value as { nanoseconds?: number }).nanoseconds || 0) / 1_000_000);
      const date = new Date(millis);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function normalizeState(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function formatDateTime(value: Date | null) {
  if (!value) return '-';
  return formatInTimeZone(value, TZ, 'dd.MM.yyyy HH:mm:ss');
}

function formatAge(value: Date | null, reference: Date) {
  if (!value) return '-';
  const diffMs = Math.max(0, reference.getTime() - value.getTime());
  const totalMinutes = Math.floor(diffMs / 60000);
  if (totalMinutes < 1) return '<1 dk';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${totalMinutes} dk`;
  return `${hours}s ${minutes} dk`;
}

function getStateBadgeClass(state: string) {
  if (state === 'running' || state === 'server_started') {
    return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200';
  }
  if (state === 'warm' || state === 'starting') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }
  if (state === 'ended' || state === 'played') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  }
  if (state === 'failed' || state === 'prepare_failed' || state === 'kickoff_failed' || state === 'stuck') {
    return 'border-rose-500/40 bg-rose-500/10 text-rose-200';
  }
  if (state === 'video' || state === 'result') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }
  return 'border-slate-500/40 bg-slate-500/10 text-slate-200';
}

function isFixtureStuck(fixture: OpsFixture, reference: Date) {
  const state = normalizeState(fixture.liveState);
  if (!ACTIVE_STATES.has(state)) {
    return false;
  }
  const lastLifecycle = fixture.lastLifecycleAt;
  if (!lastLifecycle) {
    return true;
  }
  const ageMs = reference.getTime() - lastLifecycle.getTime();
  const thresholdMs = WARM_STATES.has(state) ? 20 * 60 * 1000 : 15 * 60 * 1000;
  return ageMs > thresholdMs;
}

async function loadDashboardSnapshot(dayKey: string): Promise<DashboardSnapshot> {
  const [heartbeatSnap, leaguesSnap] = await Promise.all([
    getDoc(doc(db, 'ops_heartbeats', dayKey)),
    getDocs(collection(db, 'leagues')),
  ]);

  const dayStart = fromZonedTime(`${dayKey} 00:00:00`, TZ);
  const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const fixturesPerLeague = await Promise.all(
    leaguesSnap.docs.map(async (leagueDoc) => {
      const fixtureQuery = query(
        collection(db, 'leagues', leagueDoc.id, 'fixtures'),
        where('date', '>=', Timestamp.fromDate(dayStart)),
        where('date', '<', Timestamp.fromDate(nextDay)),
      );
      const fixtureSnap = await getDocs(fixtureQuery);
      return fixtureSnap.docs.map((fixtureDoc) => {
        const raw = fixtureDoc.data() as Record<string, any>;
        const live = (raw.live || {}) as Record<string, any>;
        const score =
          raw.score && typeof raw.score === 'object'
            ? `${Number(raw.score.home ?? raw.score.h ?? 0)}-${Number(raw.score.away ?? raw.score.a ?? 0)}`
            : '-';
        return {
          id: fixtureDoc.id,
          leagueId: leagueDoc.id,
          status: String(raw.status || 'scheduled'),
          date: parseDate(raw.date),
          scoreText: score,
          liveState: String(live.state || ''),
          nodeId: typeof live.nodeId === 'string' && live.nodeId.trim() ? live.nodeId : null,
          matchId: typeof live.matchId === 'string' && live.matchId.trim() ? live.matchId : null,
          videoMissing: raw.videoMissing === true || raw.video?.uploaded === false,
          resultMissing: live.resultMissing === true,
          lastLifecycleAt: parseDate(live.lastLifecycleAt),
        } satisfies OpsFixture;
      });
    }),
  );

  return {
    heartbeat: heartbeatSnap.exists() ? (heartbeatSnap.data() as Record<string, unknown>) : null,
    fixtures: fixturesPerLeague.flat().sort((a, b) => {
      const aTime = a.date?.getTime() || 0;
      const bTime = b.date?.getTime() || 0;
      return aTime - bTime;
    }),
    leagueCount: leaguesSnap.size,
    fetchedAt: new Date(),
  };
}

function getIssueLabel(fixture: OpsFixture, reference: Date) {
  if (fixture.videoMissing) return 'video';
  if (fixture.resultMissing) return 'result';
  if (isFixtureStuck(fixture, reference)) return 'stuck';
  if (fixture.status === 'failed' || normalizeState(fixture.liveState) === 'failed') return 'failed';
  return '';
}

export default function LiveLeagueOpsPage() {
  const { user } = useAuth();
  const [selectedDay, setSelectedDay] = useState(getTodayKey);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const refresh = async (options?: { silent?: boolean }) => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    if (!options?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const nextSnapshot = await loadDashboardSnapshot(selectedDay);
      setSnapshot(nextSnapshot);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Canli lig operasyon verisi okunamadi.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [selectedDay, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [selectedDay, isAdmin]);

  const metrics = useMemo(() => {
    const now = snapshot?.fetchedAt || new Date();
    const fixtures = snapshot?.fixtures || [];
    const activeFixtures = fixtures.filter((fixture) => ACTIVE_STATES.has(normalizeState(fixture.liveState)));
    const warmQueue = fixtures.filter((fixture) => WARM_STATES.has(normalizeState(fixture.liveState)));
    const failed = fixtures.filter((fixture) => {
      const state = normalizeState(fixture.liveState);
      return fixture.status === 'failed' || state === 'failed' || state === 'prepare_failed' || state === 'kickoff_failed';
    });
    const played = fixtures.filter((fixture) => fixture.status === 'played');
    const stuck = fixtures.filter((fixture) => isFixtureStuck(fixture, now));
    const uploadIssues = fixtures.filter((fixture) => fixture.videoMissing || fixture.resultMissing);

    const nodes = new Map<string, NodeOccupancy>();
    for (const fixture of fixtures) {
      if (!fixture.nodeId) continue;
      const state = normalizeState(fixture.liveState);
      const existing = nodes.get(fixture.nodeId) || {
        nodeId: fixture.nodeId,
        active: 0,
        warm: 0,
        running: 0,
        failed: 0,
        total: 0,
      };
      existing.total += 1;
      if (ACTIVE_STATES.has(state)) existing.active += 1;
      if (WARM_STATES.has(state)) existing.warm += 1;
      if (state === 'running' || state === 'server_started') existing.running += 1;
      if (state === 'failed' || state === 'prepare_failed' || state === 'kickoff_failed') existing.failed += 1;
      nodes.set(fixture.nodeId, existing);
    }

    const heartbeat = snapshot?.heartbeat || {};
    const preparedCount = Number(heartbeat.leaguePreparePrepared || 0) + Number(heartbeat.leaguePrepareReused || 0);
    const kickoffStarted = Number(heartbeat.leagueKickoffStarted || 0);
    const kickoffRate = preparedCount > 0 ? Math.round((kickoffStarted / preparedCount) * 100) : null;

    return {
      now,
      fixtures,
      activeFixtures,
      warmQueue,
      failed,
      played,
      stuck,
      uploadIssues,
      nodeRows: Array.from(nodes.values()).sort((a, b) => b.active - a.active || a.nodeId.localeCompare(b.nodeId)),
      heartbeat,
      kickoffRate,
    };
  }, [snapshot]);

  const riskFixtures = useMemo(() => {
    const now = metrics.now;
    return metrics.fixtures
      .filter((fixture) => getIssueLabel(fixture, now))
      .sort((a, b) => {
        const aTime = a.lastLifecycleAt?.getTime() || 0;
        const bTime = b.lastLifecycleAt?.getTime() || 0;
        return aTime - bTime;
      })
      .slice(0, 25);
  }, [metrics]);

  const heartbeatRows = useMemo(() => {
    const heartbeat = metrics.heartbeat;
    return [
      ['Prepare', `${Number(heartbeat.leaguePreparePrepared || 0)} hazir, ${Number(heartbeat.leaguePrepareReused || 0)} reuse, ${Number(heartbeat.leaguePrepareFailed || 0)} fail`],
      ['Kickoff', `${Number(heartbeat.leagueKickoffStarted || 0)} start, ${Number(heartbeat.leagueKickoffFailed || 0)} fail, ${Number(heartbeat.leagueKickoffSkipped || 0)} skip`],
      ['Reconcile', `${Number(heartbeat.leagueReconcileChecked || 0)} check, ${Number(heartbeat.leagueReconcileUpdated || 0)} update, ${Number(heartbeat.leagueReconcileFailed || 0)} fail`],
      ['Backfill', `${Number(heartbeat.leagueMediaBackfillChecked || 0)} check, ${Number(heartbeat.leagueMediaBackfillResultRecovered || 0)} result, ${Number(heartbeat.leagueMediaBackfillRenderQueued || 0)} render`],
    ];
  }, [metrics.heartbeat]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-6 lg:p-8">
        <PagesHeader title="Canli Lig Ops" description="Bu ekran yalnizca admin hesaplari icin aciktir." />
        <Card className="mt-6 border-rose-500/20 bg-rose-950/20 text-slate-100">
          <CardContent className="flex items-center gap-3 p-6">
            <ShieldAlert className="h-5 w-5 text-rose-300" />
            <p className="text-sm text-slate-200">Bu ekrana erisim icin admin rolu gerekiyor.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-6 lg:p-8">
      <PagesHeader
        title="Canli Lig Ops"
        description="Warm kuyrugu, node dolulugu, kickoff durumu ve media risklerini tek ekranda izler."
      />

      <div className="mt-6 space-y-6">
        <Card className="border-white/10 bg-slate-900/60 text-slate-100 backdrop-blur-lg">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Kontrol Araligi</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  type="date"
                  value={selectedDay}
                  onChange={(event) => setSelectedDay(event.target.value)}
                  className="w-full border-white/10 bg-slate-950/70 text-slate-100 sm:w-[220px]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void refresh()}
                  disabled={loading}
                  className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Yenile
                </Button>
              </div>
            </div>

            <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
              <div>Leagues: <span className="font-semibold text-white">{snapshot?.leagueCount ?? 0}</span></div>
              <div>Fixtures: <span className="font-semibold text-white">{metrics.fixtures.length}</span></div>
              <div>Fetched: <span className="font-semibold text-white">{formatDateTime(snapshot?.fetchedAt || null)}</span></div>
              <div>Kickoff rate: <span className="font-semibold text-white">{metrics.kickoffRate === null ? '-' : `%${metrics.kickoffRate}`}</span></div>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Card className="border-rose-500/20 bg-rose-950/20 text-slate-100">
            <CardContent className="flex items-center gap-3 p-6">
              <AlertTriangle className="h-5 w-5 text-rose-300" />
              <p className="text-sm text-slate-200">{error}</p>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-white/10 bg-slate-900/60 text-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Activity className="h-4 w-4 text-cyan-300" />
                Aktif Match
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-white">{metrics.activeFixtures.length}</div>
              <p className="mt-1 text-xs text-slate-400">Warm, starting, server_started ve running</p>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-slate-900/60 text-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Clock3 className="h-4 w-4 text-amber-300" />
                Warm Queue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-white">{metrics.warmQueue.length}</div>
              <p className="mt-1 text-xs text-slate-400">19:00 oncesi hazir bekleyen fixture sayisi</p>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-slate-900/60 text-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <AlertTriangle className="h-4 w-4 text-rose-300" />
                Riskli Fixture
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-white">{riskFixtures.length}</div>
              <p className="mt-1 text-xs text-slate-400">Stuck, failed, resultMissing veya videoMissing</p>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-slate-900/60 text-slate-100">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                Played
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-white">{metrics.played.length}</div>
              <p className="mt-1 text-xs text-slate-400">Result finalize ile kapanmis maclar</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
          <Card className="border-white/10 bg-slate-900/60 text-slate-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4 text-cyan-300" />
                Node Dolulugu
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
                    <th className="pb-3">Node</th>
                    <th className="pb-3">Active</th>
                    <th className="pb-3">Warm</th>
                    <th className="pb-3">Running</th>
                    <th className="pb-3">Failed</th>
                    <th className="pb-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.nodeRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">
                        Bu gun icin node verisi yok.
                      </td>
                    </tr>
                  ) : (
                    metrics.nodeRows.map((row) => (
                      <tr key={row.nodeId} className="border-b border-white/5 text-slate-200">
                        <td className="py-3 font-medium text-white">{row.nodeId}</td>
                        <td className="py-3">{row.active}</td>
                        <td className="py-3">{row.warm}</td>
                        <td className="py-3">{row.running}</td>
                        <td className="py-3">{row.failed}</td>
                        <td className="py-3">{row.total}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-slate-900/60 text-slate-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Video className="h-4 w-4 text-amber-300" />
                Heartbeat Ozeti
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Kickoff Success</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {metrics.kickoffRate === null ? '-' : `%${metrics.kickoffRate}`}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Upload Risk</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{metrics.uploadIssues.length}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Failed</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{metrics.failed.length}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Stuck</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{metrics.stuck.length}</div>
                </div>
              </div>

              <div className="space-y-3 border-t border-white/10 pt-4 text-sm text-slate-300">
                {heartbeatRows.map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4">
                    <span className="font-medium text-slate-400">{label}</span>
                    <span className="text-right text-slate-200">{value}</span>
                  </div>
                ))}
                <div className="flex items-start justify-between gap-4">
                  <span className="font-medium text-slate-400">Last updated</span>
                  <span className="text-right text-slate-200">
                    {formatDateTime(parseDate(metrics.heartbeat.lastUpdated))}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-slate-900/60 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-rose-300" />
              Riskli Fixture Listesi
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
                  <th className="pb-3">League</th>
                  <th className="pb-3">Fixture</th>
                  <th className="pb-3">Kickoff</th>
                  <th className="pb-3">State</th>
                  <th className="pb-3">Node</th>
                  <th className="pb-3">Age</th>
                  <th className="pb-3">Score</th>
                  <th className="pb-3">Issue</th>
                </tr>
              </thead>
              <tbody>
                {riskFixtures.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500">
                      Kritik risk gorunmuyor.
                    </td>
                  </tr>
                ) : (
                  riskFixtures.map((fixture) => {
                    const issue = getIssueLabel(fixture, metrics.now);
                    const normalizedState = normalizeState(fixture.liveState || fixture.status);
                    return (
                      <tr key={`${fixture.leagueId}-${fixture.id}`} className="border-b border-white/5 text-slate-200">
                        <td className="py-3 font-medium text-white">{fixture.leagueId}</td>
                        <td className="py-3">{fixture.id}</td>
                        <td className="py-3">{formatDateTime(fixture.date)}</td>
                        <td className="py-3">
                          <Badge className={getStateBadgeClass(normalizedState)}>
                            {normalizedState || fixture.status}
                          </Badge>
                        </td>
                        <td className="py-3">{fixture.nodeId || '-'}</td>
                        <td className="py-3">{formatAge(fixture.lastLifecycleAt, metrics.now)}</td>
                        <td className="py-3">{fixture.scoreText}</td>
                        <td className="py-3">
                          <Badge className={getStateBadgeClass(issue)}>{issue}</Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

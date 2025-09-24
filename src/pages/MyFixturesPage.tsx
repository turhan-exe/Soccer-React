import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  getFixturesForTeamSlotAware,
  getMyLeagueId,
  getLeagueTeams,
  ensureFixturesForLeague,
  getLeagueForTeam,
  getFixturesForTeam,
  playNextScheduledDay,
} from '@/services/leagues';
import type { Fixture } from '@/types';
import { formatInTimeZone } from 'date-fns-tz';
import { tr } from 'date-fns/locale';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/services/firebase';
import { getReplay } from '@/services/matches';
import { subscribeLiveMeta, type LiveMeta } from '@/services/live';
import { BackButton } from '@/components/ui/back-button';

interface DisplayFixture extends Fixture {
  opponent: string;
  home: boolean;
}

const TZ = 'Europe/Istanbul';

function formatTR(d: Date) {
  return formatInTimeZone(d, TZ, 'dd MMM yyyy, HH:mm', { locale: tr });
}
function dayKey(d: Date) {
  return formatInTimeZone(d, TZ, 'yyyy-MM-dd');
}
function dayTitle(d: Date) {
  return formatInTimeZone(d, TZ, 'dd MMM yyyy', { locale: tr });
}

export default function MyFixturesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [fixtures, setFixtures] = useState<DisplayFixture[]>([]);
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [myLeagueId, setMyLeagueId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [myTeamName, setMyTeamName] = useState<string>('Takımım');
  const [liveMap, setLiveMap] = useState<Record<string, boolean>>({});
  const liveUnsubs = React.useRef<Record<string, () => void>>({});

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const leagueId = await getMyLeagueId(user.id);
      if (!leagueId) {
        setFixtures([]);
        setMyLeagueId(null);
        return;
      }
      setMyLeagueId(leagueId);
      // Ligde fikstür yoksa oluşturmayı dene (idempotent backend)
      await ensureFixturesForLeague(leagueId);
      const [list, teams] = await Promise.all([
        getFixturesForTeamSlotAware(leagueId, user.id),
        getLeagueTeams(leagueId),
      ]);
      const teamMap = new Map(teams.map((t) => [t.id, t.name]));
      const selfName = teamMap.get(user.id) || user.teamName || 'Takımım';
      const mapped: DisplayFixture[] = list.map((m) => {
        const home = m.homeTeamId === user.id;
        const opponentId = home ? m.awayTeamId : m.homeTeamId;
        return {
          ...m,
          opponent: teamMap.get(opponentId) || opponentId,
          home,
        };
      });
      setMyTeamName(selfName);
      // Not: takım adları ileride başlıkta gösterilebilir
      setFixtures(mapped);
    };
    load();
  }, [user]);

  // Eldeki yükleme mantığını tekrar kullanan küçük bir yeniden yükleme yardımcı fonksiyonu
  const reloadFixtures = React.useCallback(async () => {
    if (!user) return;
    const leagueId = await getMyLeagueId(user.id);
    if (!leagueId) {
      setFixtures([]);
      setMyLeagueId(null);
      return;
    }
    setMyLeagueId(leagueId);
    await ensureFixturesForLeague(leagueId);
    const [list, teams] = await Promise.all([
      getFixturesForTeamSlotAware(leagueId, user.id),
      getLeagueTeams(leagueId),
    ]);
    const teamMap = new Map(teams.map((t) => [t.id, t.name]));
    const mapped: DisplayFixture[] = list.map((m) => {
      const home = m.homeTeamId === user.id;
      const opponentId = home ? m.awayTeamId : m.homeTeamId;
      return { ...m, opponent: teamMap.get(opponentId) || opponentId, home };
    });
    setFixtures(mapped);
  }, [user]);

  // Subscribe to live meta for non-played fixtures and build a live status map
  useEffect(() => {
    // cleanup previous
    Object.values(liveUnsubs.current).forEach((fn) => fn());
    liveUnsubs.current = {};
    const targets = fixtures.filter((f) => f.status !== 'played');
    if (targets.length === 0) {
      setLiveMap({});
      return;
    }
    const next: Record<string, boolean> = {};
    targets.forEach((f) => {
      const unsub = subscribeLiveMeta(f.id, (m: LiveMeta | null) => {
        const isLive = !!(m && (m.status === 'live' || (m.startedAt && !m.endedAt)));
        setLiveMap((prev) => ({ ...prev, [f.id]: isLive }));
      });
      liveUnsubs.current[f.id] = unsub;
      next[f.id] = false;
    });
    setLiveMap((prev) => ({ ...next, ...prev }));
    return () => {
      Object.values(liveUnsubs.current).forEach((fn) => fn());
      liveUnsubs.current = {};
    };
  }, [fixtures]);

  const isHistoryRoute = location.pathname.includes('match-history');
  const visibleFixtures = useMemo(() => {
    if (isHistoryRoute) return fixtures.filter((f) => f.status === 'played');
    return upcomingOnly ? fixtures.filter((f) => f.status !== 'played') : fixtures;
  }, [fixtures, upcomingOnly, isHistoryRoute]);

  // Gün bazında gruplama
  const grouped = useMemo(() => {
    const g: Record<string, DisplayFixture[]> = {};
    for (const f of visibleFixtures) {
      const key = dayKey(f.date as Date);
      (g[key] ||= []).push(f);
    }
    return g;
  }, [visibleFixtures]);

  const handleGenerateFixtures = async () => {
    if (!user || !myLeagueId) {
      toast.message('Lig bulunamadı', {
        description: 'Önce bir lige katılmalısınız.',
      });
      return;
    }
    try {
      setBusy(true);
      const toastId = toast.loading('Fikstür oluşturuluyor...', {
        description: 'Lütfen bekleyin.',
      });
      const fn = httpsCallable(functions, 'generateRoundRobinFixturesFn');
      await fn({ leagueId: myLeagueId, force: true });
      const [list, teams] = await Promise.all([
        getFixturesForTeam(myLeagueId, user.id),
        getLeagueTeams(myLeagueId),
      ]);
      const teamMap = new Map(teams.map((t) => [t.id, t.name]));
      const mapped: DisplayFixture[] = list.map((m) => {
        const home = m.homeTeamId === user.id;
        const opponentId = home ? m.awayTeamId : m.homeTeamId;
        return {
          ...m,
          opponent: teamMap.get(opponentId) || opponentId,
          home,
        };
      });
      setFixtures(mapped);
      toast.success('Fikstür yeniden oluşturuldu', {
        description: 'Maçlar başarıyla güncellendi.',
        id: toastId,
      });
    } catch (e) {
      console.warn('[MyFixturesPage] generate fixtures failed', e);
      toast.error('Hata', {
        description: 'Fikstür oluşturulamadı. Lütfen tekrar deneyin.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePlayNextMatchDay = async () => {
    // Sistemde planlı maç günü ne ise, onu bugün oynat
    let toastId: string | number | undefined;
    try {
      setPlaying(true);
      toastId = toast.loading('Maçlar başlatılıyor...', { description: 'Sıradaki maç günü' });
      const res = await playNextScheduledDay();
      if (!res) {
        if (toastId !== undefined) toast.message('Oynatılacak maç yok', { description: 'Yaklaşan maç bulunamadı.', id: toastId });
        else toast.message('Oynatılacak maç yok', { description: 'Yaklaşan maç bulunamadı.' });
        return;
      }
      const total = res.total ?? 0;
      const started = res.started ?? 0;
      const day = res.dayKey ? `(${res.dayKey}) ` : '';
      toast.success('Başlatma tamamlandı', { description: `${day}${started}/${total} maç başlatıldı.`, id: toastId });
      reloadFixtures();
    } catch (e: any) {
      const m: string = e?.message || 'İşlem başarısız';
      if (toastId !== undefined) toast.error('Hata', { description: m, id: toastId });
      else toast.error('Hata', { description: m });
    } finally {
      setPlaying(false);
    }
  };

  const dayKeys = Object.keys(grouped).sort();

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <BackButton />
        <h1 className="text-xl font-bold">{isHistoryRoute ? 'Maç Geçmişi' : 'Fikstür'}</h1>
        <div className="flex items-center space-x-2">
          {!isHistoryRoute && (
            <>
              <span className="text-sm">Sadece yaklaşan</span>
              <Switch
                checked={upcomingOnly}
                onCheckedChange={setUpcomingOnly}
                aria-label="Upcoming only toggle"
              />
            </>
          )}
          <Button size="sm" onClick={handleGenerateFixtures} disabled={!myLeagueId || busy}>
            Fikstürü Oluştur
          </Button>
          {!isHistoryRoute && (
            <Button size="sm" variant="secondary" onClick={handlePlayNextMatchDay} disabled={playing}>
              Bir Sonraki Maçları Oynat
            </Button>
          )}
        </div>
      </div>

      {dayKeys.length === 0 ? (
        <div className="text-sm text-muted-foreground">Gösterilecek maç yok.</div>
      ) : (
        <div className="space-y-6">
          {dayKeys.map((key) => {
            const rows = grouped[key]!;
            const title = dayTitle(rows[0].date as Date);
            return (
              <section key={key}>
                <div className="text-sm font-semibold text-muted-foreground mb-2">{title}</div>
                <div className="space-y-2">
                  {rows.map((m) => {
                    const isPlayed = m.status === 'played';
                    const isLive = !isPlayed && !!liveMap[m.id];
                    const when = formatTR(m.date as Date);
                    const homeAway = m.home ? 'EV' : 'DEP';
                    const scoreText = isPlayed && m.score ? `${m.score.home}-${m.score.away}` : 'vs';
                    return (
                      <Card key={m.id} data-testid={`fixture-row-${m.id}`} className="overflow-hidden">
                        <CardContent className="p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <Badge variant={isLive ? 'default' : 'secondary'}>
                              {isPlayed ? 'Bitti' : isLive ? 'Canlı' : 'Planlı'}
                            </Badge>
                            <div className="text-sm">
                              <div className="font-semibold">
                                {m.home ? myTeamName : m.opponent} {scoreText} {m.home ? m.opponent : myTeamName}
                              </div>
                              <div className="text-muted-foreground">{when} · {homeAway}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isPlayed && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/match/${m.id}`)}
                              >
                                İzle
                              </Button>
                            )}
                            {myLeagueId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => navigate(`/leagues/${myLeagueId}`)}
                              >
                                Lig
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

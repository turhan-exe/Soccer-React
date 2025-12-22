import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { ensureDefaultLeague, listLeagues, listenMyLeague } from '@/services/leagues';
import { Skeleton } from '@/components/ui/skeleton';
import type { League } from '@/types';
import { BackButton } from '@/components/ui/back-button';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { playAllForDay, playNextScheduledDay, requestBootstrap } from '@/services/leagues';
import { formatInTimeZone } from 'date-fns-tz';

export default function LeaguesListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [myLeagueId, setMyLeagueId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const load = async () => {
      try {
        await ensureDefaultLeague();
        const ls = await listLeagues();
        setLeagues(ls);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = listenMyLeague(user.id, (league) => {
      setMyLeagueId(league?.id ?? null);
    });
    return unsub;
  }, [user]);

  const myLeague = leagues.find((l) => l.id === myLeagueId) || null;
  const otherLeagues = leagues.filter((l) => l.id !== myLeagueId);

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <BackButton />
        <h1 className="text-xl font-bold">Ligler</h1>
      </div>
      {/* Test/Operator buttons: only in dev builds */}
      {(import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_BUTTONS === '1') && (
        <div className="flex flex-wrap gap-2 mb-4">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await requestBootstrap();
                const ls = await listLeagues();
                setLeagues(ls);
                toast({ description: 'Aylık ligler oluşturuldu/yenilendi.' });
              } catch (e: any) {
                toast({ description: e?.message || 'Bootstrap hata', });
              }
            }}
          >
            Test: Ligleri Oluştur (Aylık)
          </Button>
          <Button
            onClick={async () => {
              const dayKey = formatInTimeZone(new Date(), 'Europe/Istanbul', 'yyyy-MM-dd');
              try {
                const r = await playAllForDay(dayKey, { instant: true });
                toast({ description: `Bugün (${dayKey}) maçlar: ${r?.started ?? 0}/${r?.total ?? 0}` });
              } catch (e: any) {
                toast({ description: e?.message || 'Bugün oynatma hatası' });
              }
            }}
          >
            Test: Bugünü Oynat (TR)
          </Button>
          <Button
            onClick={async () => {
              try {
                const r = await playNextScheduledDay();
                if (!r) { toast({ description: 'Planlı maç bulunamadı.' }); return; }
                toast({ description: `Gün (${r.dayKey}) maçlar: ${r.started ?? 0}/${r.total ?? 0}` });
              } catch (e: any) {
                toast({ description: e?.message || 'Sonraki günü oynatma hatası' });
              }
            }}
          >
            Test: Sonraki Günü Oynat
          </Button>
        </div>
      )}
      {loading && (
        <div className="space-y-2" data-testid="leagues-loading">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {!loading && leagues.length === 0 && (
        <p
          data-testid="no-leagues-message"
          className="text-sm text-muted-foreground"
        >
          Henüz lig oluşturulmamış.
        </p>
      )}
      {myLeague && (
        <div className="mb-6">
          <h2 className="font-semibold mb-2">Takımının Ligi</h2>
          <Card
            key={myLeague.id}
            data-testid={`league-row-${myLeague.id}`}
            className="cursor-pointer"
            onClick={() => navigate(`/leagues/${myLeague.id}`)}
          >
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="font-semibold">{myLeague.name}</div>
                <div className="text-sm text-muted-foreground">
                  Sezon {myLeague.season} - {myLeague.teamCount ?? 0}/{myLeague.capacity}
                </div>
                {myLeague.teams && myLeague.teams.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Takımlar: {myLeague.teams.map((t) => t.name).join(', ')}
                  </div>
                )}
              </div>
              <Badge>{myLeague.state}</Badge>
            </CardContent>
          </Card>
        </div>
      )}
      {otherLeagues.length > 0 && (
        <div className="space-y-2">
          {myLeague && <h2 className="font-semibold mb-2">Diğer Ligler</h2>}
          {otherLeagues.map((l) => (
            <Card
              key={l.id}
              data-testid={`league-row-${l.id}`}
              className="cursor-pointer"
              onClick={() => navigate(`/leagues/${l.id}`)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <div className="font-semibold">{l.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Sezon {l.season} - {l.teamCount ?? 0}/{l.capacity}
                  </div>
                  {l.teams && l.teams.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Takımlar: {l.teams.map((t) => t.name).join(', ')}
                    </div>
                  )}
                </div>
                <Badge>{l.state}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}


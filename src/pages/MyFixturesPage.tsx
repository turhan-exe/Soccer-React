import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  getFixturesForTeam,
  getMyLeagueId,
  getLeagueTeams,
  ensureFixturesForLeague,
} from '@/services/leagues';
import type { Fixture } from '@/types';
import { formatInTimeZone } from 'date-fns-tz';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/services/firebase';

interface DisplayFixture extends Fixture {
  opponent: string;
  home: boolean;
}

export default function MyFixturesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fixtures, setFixtures] = useState<DisplayFixture[]>([]);
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [myLeagueId, setMyLeagueId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      // Backfill: ensure fixtures exist when a league just got scheduled
      await ensureFixturesForLeague(leagueId);
      const [list, teams] = await Promise.all([
        getFixturesForTeam(leagueId, user.id),
        getLeagueTeams(leagueId),
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
    };
    load();
  }, [user]);

  const formatDate = (d: Date) =>
    formatInTimeZone(d, 'Europe/Istanbul', 'dd MMM yyyy, HH:mm');

  const visibleFixtures = upcomingOnly
    ? fixtures.filter((f) => f.status !== 'played')
    : fixtures;

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

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
      <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
        <h1 className="text-xl font-bold">Fikstür</h1>
        <div className="flex items-center space-x-2">
          <span className="text-sm">Sadece yaklaşan</span>
          <Switch
            checked={upcomingOnly}
            onCheckedChange={setUpcomingOnly}
            aria-label="Upcoming only toggle"
          />
          <Button
            size="sm"
            onClick={handleGenerateFixtures}
            disabled={!myLeagueId || busy}
          >
            Fikstürü Oluştur
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {visibleFixtures.map((m) => (
          <Card key={m.id} data-testid={`fixture-row-${m.id}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">Round {m.round}</div>
                <div className="text-sm text-muted-foreground">
                  {formatDate(m.date as unknown as Date)}
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2">
                  <Badge variant="outline">{m.home ? 'H' : 'A'}</Badge>
                  <span>{m.opponent}</span>
                </div>
                {m.status === 'played' && m.score ? (
                  <div className="font-bold">
                    {m.score.home}-{m.score.away}
                  </div>
                ) : (
                  <Badge>{m.status}</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getFixturesForTeam, getMyLeagueId, getLeagueTeams } from '@/services/leagues';
import type { Fixture } from '@/types';
import { UnityPracticeView } from '@/components/unity/UnityPracticeView';

type DisplayFixture = Fixture & { opponent: string; home: boolean };

export default function MatchSimulation() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [nextFixture, setNextFixture] = useState<DisplayFixture | null>(null);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      try {
        const lid = await getMyLeagueId(user.id);
        if (!lid) {
          setLeagueId(null);
          setNextFixture(null);
          return;
        }
        setLeagueId(lid);
        const [fixtures, teams] = await Promise.all([
          getFixturesForTeam(lid, user.id),
          getLeagueTeams(lid),
        ]);
        const teamMap = new Map(teams.map((t) => [t.id, t.name]));
        const upcoming = fixtures
          .filter((f) => f.status !== 'played')
          .sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime())[0];
        if (!upcoming) {
          setNextFixture(null);
          return;
        }
        const home = upcoming.homeTeamId === user.id;
        const opponentId = home ? upcoming.awayTeamId : upcoming.homeTeamId;
        setNextFixture({
          ...upcoming,
          opponent: teamMap.get(opponentId) || opponentId,
          home,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const header = (
    <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
          <h1 className="text-xl font-bold">Antrenman Maçı (Gelecek Maç)</h1>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen">
        {header}
        <div className="p-4">Yükleniyor…</div>
      </div>
    );
  }

  if (!nextFixture || !leagueId) {
    return (
      <div className="min-h-screen">
        {header}
        <div className="p-4">
          <Card>
            <CardContent className="p-4">
              Yaklaşan maç bulunamadı veya lig bilgisi eksik.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {header}
      <div className="p-4 space-y-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="text-sm">
              <div className="font-semibold">
                {nextFixture.home ? 'Takımım' : nextFixture.opponent} vs {nextFixture.home ? nextFixture.opponent : 'Takımım'}
              </div>
              <div className="text-muted-foreground">Id: {nextFixture.id}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/team-planning')}>Kadroyu Ayarla</Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/fixtures')}>Fikstür</Button>
            </div>
          </CardContent>
        </Card>

        <UnityPracticeView
          matchId={nextFixture.id}
          leagueId={leagueId}
          homeTeamId={nextFixture.homeTeamId}
          awayTeamId={nextFixture.awayTeamId}
        />
      </div>
    </div>
  );
}

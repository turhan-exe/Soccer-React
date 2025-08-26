import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { listenMyLeague, getFixturesForTeam } from '@/services/leagues';
import type { Fixture } from '@/types';

export default function Fixtures() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fixtures, setFixtures] = useState<Fixture[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsub = listenMyLeague(user.id, async (league) => {
      if (!league) {
        setFixtures([]);
        return;
      }
      const list = await getFixturesForTeam(league.id, user.id);
      setFixtures(list);
    });
    return unsub;
  }, [user]);

  const formatDate = (d: Date | { toDate: () => Date }) => {
    const date = d instanceof Date ? d : d.toDate();
    return date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour12: false });
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
        <h1 className="text-xl font-bold">Fikstür</h1>
      </div>
      <div className="space-y-2">
        {fixtures.map((m) => (
          <Card key={m.id} data-testid={`fixture-row-${m.id}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">Round {m.round}</div>
                <div className="text-sm text-muted-foreground">{formatDate(m.date)}</div>
              </div>
              <div className="text-center">
                <div>{m.homeTeamId} vs {m.awayTeamId}</div>
                {m.status === 'played' && m.score && (
                  <div className="font-bold">
                    {m.score.home}-{m.score.away}
                  </div>
                )}
                {m.status !== 'played' && (
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

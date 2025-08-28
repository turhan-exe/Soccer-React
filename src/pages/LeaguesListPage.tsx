import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { ensureDefaultLeague, listLeagues, listenMyLeague } from '@/services/leagues';
import type { League } from '@/types';

export default function LeaguesListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [myLeagueId, setMyLeagueId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      await ensureDefaultLeague();
      const ls = await listLeagues();
      setLeagues(ls);
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
      <h1 className="text-xl font-bold mb-4">Ligler</h1>
      {leagues.length === 0 && (
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

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { listLeagues } from '@/services/leagues';
import type { League } from '@/types';

export default function Leagues() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    listLeagues().then(setLeagues);
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Ligler</h1>
      <div className="space-y-2">
        {leagues.map((l) => (
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
              </div>
              <Badge>{l.state}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

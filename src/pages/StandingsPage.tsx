import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { getLeagueTeams, getMyLeagueId, listenStandings } from '@/services/leagues';
import type { Standing } from '@/types';

export default function StandingsPage() {
  const { user } = useAuth();
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [rows, setRows] = useState<Standing[]>([]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    const run = async () => {
      if (!user) return;
      const lid = await getMyLeagueId(user.id);
      setLeagueId(lid);
      if (!lid) {
        setRows([]);
        return;
      }
      unsub = listenStandings(lid, async (sRows) => {
        if (sRows.length === 0) {
          const teams = await getLeagueTeams(lid);
          setRows(
            teams.map((t) => ({
              id: t.id,
              teamId: t.id,
              name: t.name,
              P: 0,
              W: 0,
              D: 0,
              L: 0,
              GF: 0,
              GA: 0,
              GD: 0,
              Pts: 0,
            }))
          );
        } else {
          setRows(sRows);
        }
      });
    };
    run();
    return () => {
      unsub?.();
    };
  }, [user]);

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Puan Durumu</h1>
      {!leagueId ? (
        <div className="text-sm text-muted-foreground">Önce bir lige katılın.</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2 w-10">S</th>
                  <th className="p-2">Takım</th>
                  <th className="p-2">P</th>
                  <th className="p-2">W</th>
                  <th className="p-2">D</th>
                  <th className="p-2">L</th>
                  <th className="p-2">GF</th>
                  <th className="p-2">GA</th>
                  <th className="p-2">GD</th>
                  <th className="p-2">Pts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.teamId} data-testid={`standings-row-${r.teamId}`} className="border-b">
                    <td className="p-2">{idx + 1}</td>
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.P}</td>
                    <td className="p-2">{r.W}</td>
                    <td className="p-2">{r.D}</td>
                    <td className="p-2">{r.L}</td>
                    <td className="p-2">{r.GF}</td>
                    <td className="p-2">{r.GA}</td>
                    <td className="p-2">{r.GD}</td>
                    <td className="p-2">{r.Pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


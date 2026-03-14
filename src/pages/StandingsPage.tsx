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
            })),
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
    <div className="overflow-x-hidden p-3 sm:p-4">
      <h1 className="mb-4 text-xl font-bold">Puan Durumu</h1>
      {!leagueId ? (
        <div className="text-sm text-muted-foreground">{'\u00d6nce bir lige kat\u0131l\u0131n.'}</div>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full table-fixed text-xs sm:text-sm">
              <colgroup>
                <col className="w-[10%] sm:w-[8%]" />
                <col className="w-[34%] sm:w-[30%]" />
                <col className="w-[9%] sm:w-[8%]" />
                <col className="w-[9%] sm:w-[8%]" />
                <col className="w-[9%] sm:w-[8%]" />
                <col className="w-[9%] sm:w-[8%]" />
                <col className="hidden md:table-column md:w-[8%]" />
                <col className="hidden md:table-column md:w-[8%]" />
                <col className="hidden sm:table-column sm:w-[8%]" />
                <col className="w-[11%] sm:w-[8%]" />
              </colgroup>
              <thead>
                <tr className="border-b text-left">
                  <th className="px-2 py-3 text-center">S</th>
                  <th className="px-2 py-3">{'Tak\u0131m'}</th>
                  <th className="px-1 py-3 text-center">O</th>
                  <th className="px-1 py-3 text-center">G</th>
                  <th className="px-1 py-3 text-center">B</th>
                  <th className="px-1 py-3 text-center">M</th>
                  <th className="hidden px-2 py-3 text-center md:table-cell">AG</th>
                  <th className="hidden px-2 py-3 text-center md:table-cell">YG</th>
                  <th className="hidden px-2 py-3 text-center sm:table-cell">AV</th>
                  <th className="px-1 py-3 text-center">P</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.id} data-testid={`standings-row-${r.teamId}`} className="border-b">
                    <td className="px-2 py-3 text-center">{idx + 1}</td>
                    <td className="truncate px-2 py-3">{r.name}</td>
                    <td className="px-1 py-3 text-center">{r.P}</td>
                    <td className="px-1 py-3 text-center">{r.W}</td>
                    <td className="px-1 py-3 text-center">{r.D}</td>
                    <td className="px-1 py-3 text-center">{r.L}</td>
                    <td className="hidden px-2 py-3 text-center md:table-cell">{r.GF}</td>
                    <td className="hidden px-2 py-3 text-center md:table-cell">{r.GA}</td>
                    <td className="hidden px-2 py-3 text-center sm:table-cell">{r.GD}</td>
                    <td className="px-1 py-3 text-center font-semibold">{r.Pts}</td>
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


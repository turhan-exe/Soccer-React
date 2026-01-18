import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listenStandings, getLeagueTeams } from '@/services/leagues';
import type { Standing } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import BackButton from '@/components/ui/back-button';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/services/firebase';

export default function LeagueDetailPage() {
  const { leagueId } = useParams();
  const [rows, setRows] = useState<Standing[]>([]);
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenStandings(leagueId, async (sRows) => {
      if (sRows.length === 0) {
        const teams = await getLeagueTeams(leagueId);
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
        // Identify rows that update/fetch names
        sRows.forEach(async (r) => {
          const rawName = r.name || r.teamId;
          // Check if name is exactly the ID (implies missing name)
          if (rawName === r.teamId && r.teamId.length > 15 && !r.teamId.startsWith('slot-')) {
            try {
              const snap = await getDoc(doc(db, 'teams', r.teamId));
              if (snap.exists()) {
                const d = snap.data();
                if (d?.name) {
                  setResolvedNames(prev => ({ ...prev, [r.teamId]: d.name }));
                }
              }
            } catch (e) {
              console.warn('Failed to resolve team name', r.teamId);
            }
          }
        });
      }
    });
    return unsub;
  }, [leagueId]);

  const formatName = (row: Standing) => {
    // 1. If we have a resolved name, use it
    if (resolvedNames[row.teamId]) return resolvedNames[row.teamId];

    const raw = row.name || row.teamId;

    // 2. Bot logic: "Bot [LongID]" -> "Bot [ShortID]"
    if (raw.toLowerCase().startsWith('bot ')) {
      const parts = raw.split(' ');
      if (parts.length > 1) {
        const idPart = parts[1];
        // Take last 3 digits to mimic "124" style or just first 3 chars
        // User example "bot 124". Let's try 3 chars of ID.
        return `Bot ${idPart.slice(0, 3).toUpperCase()}`;
      }
    }

    // 3. Fallback: if it looks like an ID, return it (or maybe truncated?)
    // The resolvedNames effect handles fetching the real name if possible.
    return raw;
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <BackButton fallbackPath="/leagues" />
        <h1 className="text-xl font-bold">Lig Detayı</h1>
      </div>
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
                  <td className="p-2">{formatName(r)}</td>
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
    </div>
  );
}

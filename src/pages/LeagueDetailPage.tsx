import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listenStandings, getLeagueTeams } from '@/services/leagues';
import type { Standing } from '@/types';
import { PagesHeader } from '@/components/layout/PagesHeader';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/services/firebase';
import { Shield } from 'lucide-react';

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
    return raw;
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-6 lg:p-8 font-sans text-slate-100 flex flex-col gap-6">
      <PagesHeader title="Lig Detayı" description="Puan durumu ve istatistikler.." />

      <div className="bg-[#13111c]/90 border border-white/5 rounded-[32px] p-6 md:p-8 flex-1 relative shadow-2xl backdrop-blur-sm overflow-hidden">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-purple-200 tracking-wide">Puan Durumu</h2>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-[#1a1725]/50 border-b border-white/5">
              <tr>
                <th className="px-6 py-4 font-bold tracking-wider">S</th>
                <th className="px-6 py-4 font-bold tracking-wider">Takım</th>
                <th className="px-6 py-4 text-center font-bold tracking-wider">O</th>
                <th className="px-6 py-4 text-center font-bold tracking-wider">G</th>
                <th className="px-6 py-4 text-center font-bold tracking-wider">B</th>
                <th className="px-6 py-4 text-center font-bold tracking-wider">M</th>
                <th className="px-6 py-4 text-center hidden md:table-cell font-bold tracking-wider">AG</th>
                <th className="px-6 py-4 text-center hidden md:table-cell font-bold tracking-wider">YG</th>
                <th className="px-6 py-4 text-center font-bold tracking-wider">AV</th>
                <th className="px-6 py-4 text-center font-black text-white tracking-wider bg-white/5 border-l border-white/5">P</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r, idx) => (
                <tr key={r.teamId} data-testid={`standings-row-${r.teamId}`} className="hover:bg-white/5 transition-colors group">
                  <td className="px-6 py-4 font-medium text-slate-500 group-hover:text-slate-300">{idx + 1}</td>
                  <td className="px-6 py-4 font-bold text-white flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-slate-800 flex items-center justify-center shrink-0 border border-white/5">
                      <Shield className="w-4 h-4 text-purple-400 opacity-80" />
                    </div>
                    <span className="truncate max-w-[120px] md:max-w-none">{formatName(r)}</span>
                  </td>
                  <td className="px-6 py-4 text-center text-slate-300 group-hover:text-white font-medium">{r.P}</td>
                  <td className="px-6 py-4 text-center text-slate-300 group-hover:text-white font-medium">{r.W}</td>
                  <td className="px-6 py-4 text-center text-slate-300 group-hover:text-white font-medium">{r.D}</td>
                  <td className="px-6 py-4 text-center text-slate-300 group-hover:text-white font-medium">{r.L}</td>
                  <td className="px-6 py-4 text-center text-slate-500 hidden md:table-cell">{r.GF}</td>
                  <td className="px-6 py-4 text-center text-slate-500 hidden md:table-cell">{r.GA}</td>
                  <td className="px-6 py-4 text-center text-slate-300 font-medium">{r.GD}</td>
                  <td className="px-6 py-4 text-center font-black text-green-400 text-base md:text-lg bg-white/5 border-l border-white/5 shadow-[inset_0_0_20px_rgba(74,222,128,0.05)]">
                    {r.Pts}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

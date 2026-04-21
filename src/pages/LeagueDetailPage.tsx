import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from '@/contexts/LanguageContext';
import { listenStandings, getLeagueTeams } from '@/services/leagues';
import type { Standing } from '@/types';
import { PagesHeader } from '@/components/layout/PagesHeader';
import { Shield } from 'lucide-react';

export default function LeagueDetailPage() {
  const { leagueId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [rows, setRows] = useState<Standing[]>([]);

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
        const uniqueRows = sRows.filter(
          (row, index, self) => index === self.findIndex((item) => item.teamId === row.teamId),
        );
        setRows(uniqueRows);
      }
    });
    return unsub;
  }, [leagueId]);

  const formatName = (row: Standing) => {
    const raw = row.name || row.teamId;
    if (raw.toLowerCase().startsWith('bot ')) {
      const parts = raw.split(' ');
      if (parts.length > 1) {
        return `${t('leagues.detailPage.botPrefix')} ${parts[1].slice(0, 3).toUpperCase()}`;
      }
    }

    return raw;
  };

  const canOpenTeamDetail = (row: Standing) =>
    typeof row.teamId === 'string' && row.teamId.trim().length > 0 && !row.teamId.startsWith('slot-');

  const openTeamDetail = (row: Standing) => {
    if (!canOpenTeamDetail(row)) return;
    navigate(`/teams/${encodeURIComponent(row.teamId)}`);
  };

  return (
    <div className="flex min-h-screen flex-col gap-4 overflow-x-hidden bg-slate-950 p-3 font-sans text-slate-100 sm:p-4 md:gap-6 md:p-6 lg:p-8">
      <PagesHeader
        title={t('leagues.detailPage.title')}
        description={t('leagues.detailPage.description')}
      />

      <div className="relative flex-1 overflow-hidden rounded-[24px] border border-white/5 bg-[#13111c]/90 p-3 shadow-2xl backdrop-blur-sm sm:p-4 md:rounded-[32px] md:p-8">
        <div className="mb-4 md:mb-6">
          <h2 className="text-xl font-bold tracking-wide text-purple-200 md:text-2xl">
            {t('leagues.detailPage.standingsTitle')}
          </h2>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/5">
          <table className="w-full table-fixed text-left text-xs sm:text-sm">
            <colgroup>
              <col className="w-[10%] sm:w-[8%]" />
              <col className="w-[34%] sm:w-[30%] md:w-[32%]" />
              <col className="w-[9%] sm:w-[8%]" />
              <col className="w-[9%] sm:w-[8%]" />
              <col className="w-[9%] sm:w-[8%]" />
              <col className="w-[9%] sm:w-[8%]" />
              <col className="hidden md:table-column md:w-[8%]" />
              <col className="hidden md:table-column md:w-[8%]" />
              <col className="hidden sm:table-column sm:w-[8%]" />
              <col className="w-[11%] sm:w-[8%]" />
            </colgroup>
            <thead className="border-b border-white/5 bg-[#1a1725]/50 text-[10px] uppercase text-slate-500 sm:text-xs">
              <tr>
                <th className="px-2 py-3 text-center font-bold tracking-wider sm:px-3 md:px-4">{t('leagues.detailPage.columns.rank')}</th>
                <th className="px-2 py-3 font-bold tracking-wider sm:px-3 md:px-4">{t('leagues.detailPage.columns.team')}</th>
                <th className="px-1 py-3 text-center font-bold tracking-wider sm:px-2 md:px-3">{t('leagues.detailPage.columns.played')}</th>
                <th className="px-1 py-3 text-center font-bold tracking-wider sm:px-2 md:px-3">{t('leagues.detailPage.columns.won')}</th>
                <th className="px-1 py-3 text-center font-bold tracking-wider sm:px-2 md:px-3">{t('leagues.detailPage.columns.draw')}</th>
                <th className="px-1 py-3 text-center font-bold tracking-wider sm:px-2 md:px-3">{t('leagues.detailPage.columns.lost')}</th>
                <th className="hidden px-2 py-3 text-center font-bold tracking-wider md:table-cell md:px-3">{t('leagues.detailPage.columns.goalsFor')}</th>
                <th className="hidden px-2 py-3 text-center font-bold tracking-wider md:table-cell md:px-3">{t('leagues.detailPage.columns.goalsAgainst')}</th>
                <th className="hidden px-2 py-3 text-center font-bold tracking-wider sm:table-cell sm:px-3">{t('leagues.detailPage.columns.goalDiff')}</th>
                <th className="border-l border-white/5 bg-white/5 px-1 py-3 text-center font-black tracking-wider text-white sm:px-2 md:px-3">{t('leagues.detailPage.columns.points')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r, idx) => (
                <tr
                  key={r.id}
                  data-testid={`standings-row-${r.teamId}`}
                  role={canOpenTeamDetail(r) ? 'button' : undefined}
                  tabIndex={canOpenTeamDetail(r) ? 0 : undefined}
                  title={canOpenTeamDetail(r) ? t('friends.actions.viewTeam') : undefined}
                  onClick={() => openTeamDetail(r)}
                  onKeyDown={(event) => {
                    if (!canOpenTeamDetail(r)) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openTeamDetail(r);
                    }
                  }}
                  className={`group transition-colors hover:bg-white/5 ${
                    canOpenTeamDetail(r) ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70' : ''
                  }`}
                >
                  <td className="px-2 py-3 text-center font-medium text-slate-500 group-hover:text-slate-300 sm:px-3 md:px-4">
                    {idx + 1}
                  </td>
                  <td className="px-2 py-3 font-bold text-white sm:px-3 md:px-4">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/5 bg-slate-800 sm:h-8 sm:w-8">
                        <Shield className="h-3.5 w-3.5 text-purple-400 opacity-80 sm:h-4 sm:w-4" />
                      </div>
                      <span className="block truncate group-hover:text-emerald-200">{formatName(r)}</span>
                    </div>
                  </td>
                  <td className="px-1 py-3 text-center font-medium text-slate-300 group-hover:text-white sm:px-2 md:px-3">{r.P}</td>
                  <td className="px-1 py-3 text-center font-medium text-slate-300 group-hover:text-white sm:px-2 md:px-3">{r.W}</td>
                  <td className="px-1 py-3 text-center font-medium text-slate-300 group-hover:text-white sm:px-2 md:px-3">{r.D}</td>
                  <td className="px-1 py-3 text-center font-medium text-slate-300 group-hover:text-white sm:px-2 md:px-3">{r.L}</td>
                  <td className="hidden px-2 py-3 text-center text-slate-500 md:table-cell md:px-3">{r.GF}</td>
                  <td className="hidden px-2 py-3 text-center text-slate-500 md:table-cell md:px-3">{r.GA}</td>
                  <td className="hidden px-2 py-3 text-center font-medium text-slate-300 sm:table-cell sm:px-3">{r.GD}</td>
                  <td className="border-l border-white/5 bg-white/5 px-1 py-3 text-center text-sm font-black text-green-400 shadow-[inset_0_0_20px_rgba(74,222,128,0.05)] sm:px-2 sm:text-base md:px-3 md:text-lg">
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


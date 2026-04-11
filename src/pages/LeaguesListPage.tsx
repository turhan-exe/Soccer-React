import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  ensureDefaultLeague,
  hydrateLeagueTeamCounts,
  listLeagues,
  listenMyLeague,
} from '@/services/leagues';
import type { League } from '@/types';
import { PagesHeader } from '@/components/layout/PagesHeader';
import { Shield, ChevronRight, Trophy, Users } from 'lucide-react';
import { format } from 'date-fns';

export default function LeaguesListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [myLeagueId, setMyLeagueId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [hydratedCounts, setHydratedCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const load = async () => {
      try {
        let ls = await listLeagues({ includeTeams: false });
        if (ls.length === 0) {
          await ensureDefaultLeague();
          ls = await listLeagues({ includeTeams: false });
        }
        setLeagues(ls);
      } finally {
        setLoading(false);
      }
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

  useEffect(() => {
    if (leagues.length === 0) {
      setHydratedCounts({});
      return;
    }

    let cancelled = false;

    void (async () => {
      const counts = await hydrateLeagueTeamCounts(leagues.map((league) => league.id));
      if (!cancelled) setHydratedCounts(counts);
    })();

    return () => {
      cancelled = true;
    };
  }, [leagues]);

  const myLeague = leagues.find((l) => l.id === myLeagueId) || null;
  const otherLeagues = leagues.filter((l) => l.id !== myLeagueId);

  const renderTeamCount = (league: League) => {
    const fallback =
      typeof league.teamCount === 'number' && league.teamCount > 0
        ? Math.min(league.teamCount, league.capacity)
        : null;
    const resolved =
      hydratedCounts[league.id] !== undefined
        ? Math.min(hydratedCounts[league.id]!, league.capacity)
        : fallback;

    if ((resolved == null || resolved === 0) && league.state !== 'forming') {
      return String(league.capacity);
    }

    return resolved == null ? '...' : String(resolved);
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-6 lg:p-8 font-sans text-slate-100 flex flex-col gap-6">
      <PagesHeader
        title={t('leagues.listPage.title')}
        description={t('leagues.listPage.description')}
      />

      <div className="bg-[#13111c]/90 border border-white/5 rounded-[32px] p-6 md:p-8 flex-1 relative shadow-2xl backdrop-blur-sm">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-purple-200 tracking-wide">
            {t('leagues.listPage.listTitle')}
          </h2>
        </div>

        {/* Table Header (Desktop) */}
        <div className="hidden md:grid grid-cols-12 gap-4 text-slate-500 text-xs font-bold uppercase tracking-wider mb-4 px-4">
          <div className="col-span-5">{t('leagues.listPage.columns.detail')}</div>
          <div className="col-span-2 text-center">{t('leagues.listPage.columns.season')}</div>
          <div className="col-span-2 text-center">{t('leagues.listPage.columns.occupancy')}</div>
          <div className="col-span-2 text-center">{t('leagues.listPage.columns.status')}</div>
          <div className="col-span-1"></div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-10 text-slate-500">{t('leagues.listPage.loading')}</div>
          ) : leagues.length === 0 ? (
            <div className="text-center py-10 text-slate-500">{t('leagues.listPage.empty')}</div>
          ) : (
            <>
              {/* My League Section */}
              {myLeague && (
                <div
                  onClick={() => navigate(`/leagues/${myLeague.id}`)}
                  className="group grid grid-cols-1 md:grid-cols-12 items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-purple-900/20 to-[#1a1725] border border-purple-500/30 hover:border-purple-400/50 transition-all duration-300 cursor-pointer shadow-lg shadow-purple-900/5"
                >
                  <div className="col-span-5 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                      <Trophy className="text-white w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-white font-bold text-lg">{myLeague.name}</div>
                      <div className="text-purple-300 text-xs font-medium bg-purple-500/10 px-2 py-0.5 rounded-full w-fit mt-1">
                        {t('leagues.listPage.currentLeague')}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 text-center text-slate-400 font-medium">
                    #{myLeague.season}
                  </div>
                  <div className="col-span-2 text-center text-slate-400 font-medium flex items-center justify-center gap-2">
                    <Users size={14} className="text-slate-500" />
                    {renderTeamCount(myLeague)} / {myLeague.capacity}
                  </div>
                  <div className="col-span-2 flex justify-center">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${myLeague.state === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                      'bg-slate-800 text-slate-400 border-white/5'
                      }`}>
                      {t(`leagues.states.${myLeague.state}`)}
                    </span>
                  </div>
                  <div className="col-span-1 flex justify-end text-slate-500 group-hover:text-white transition-colors">
                    <ChevronRight />
                  </div>
                </div>
              )}

              {/* Other Leagues */}
              {otherLeagues.map(l => (
                <div
                  key={l.id}
                  onClick={() => navigate(`/leagues/${l.id}`)}
                  className="group grid grid-cols-1 md:grid-cols-12 items-center gap-4 p-4 rounded-2xl bg-[#1a1725] border border-white/5 hover:border-purple-500/30 transition-all duration-300 hover:bg-[#201c2d] cursor-pointer"
                >
                  <div className="col-span-5 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center">
                      <Trophy className="text-slate-500 group-hover:text-purple-400 transition-colors w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-slate-200 group-hover:text-white font-bold text-base transition-colors">{l.name}</div>
                    </div>
                  </div>
                  <div className="col-span-2 text-center text-slate-500 font-medium">
                    #{l.season}
                  </div>
                  <div className="col-span-2 text-center text-slate-500 font-medium flex items-center justify-center gap-2">
                    <Users size={14} />
                    {renderTeamCount(l)} / {l.capacity}
                  </div>
                  <div className="col-span-2 flex justify-center">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${l.state === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                      'bg-slate-800 text-slate-400 border-white/5'
                      }`}>
                      {t(`leagues.states.${l.state}`)}
                    </span>
                  </div>
                  <div className="col-span-1 flex justify-end text-slate-600 group-hover:text-white transition-colors">
                    <ChevronRight />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  getMyLeagueId,
  getFixturesForTeamSlotAware,
  getLeagueTeams,
  ensureFixturesForLeague,
} from '@/services/leagues';
import type { Fixture } from '@/types';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Shield } from 'lucide-react';
import { PagesHeader } from '@/components/layout/PagesHeader';

interface DisplayFixture extends Fixture {
  opponent: string;
  opponentId: string;
  opponentLogo?: string;
  home: boolean;
  competitionName?: string;
}

export default function MyFixturesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fixtures, setFixtures] = useState<DisplayFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [myLeagueId, setMyLeagueId] = useState<string | null>(null);

  // Load Fixtures
  useEffect(() => {
    const load = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const leagueId = await getMyLeagueId(user.id);
        if (!leagueId) {
          setFixtures([]);
          setLoading(false);
          return;
        }
        setMyLeagueId(leagueId);
        await ensureFixturesForLeague(leagueId);

        const [list, teams] = await Promise.all([
          getFixturesForTeamSlotAware(leagueId, user.id),
          getLeagueTeams(leagueId),
        ]);

        const teamMap = new Map(teams.map((t) => [t.id, t]));

        const mapped: DisplayFixture[] = list.map((m) => {
          const home = m.homeTeamId === user.id;
          const opponentId = home ? m.awayTeamId : m.homeTeamId;
          const oppTeam = teamMap.get(opponentId);
          return {
            ...m,
            opponent: oppTeam?.name || 'Rakip',
            opponentId: opponentId,
            opponentLogo: oppTeam?.logo,
            home,
            competitionName: 'Süperlig', // This could be dynamic if we had league names
          };
        });

        // Sort by date
        mapped.sort((a, b) => a.date.getTime() - b.date.getTime());
        setFixtures(mapped);
      } catch (e) {
        console.error("Fikstür yüklenirken hata:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const renderStatusIndicator = (fixture: DisplayFixture) => {
    if (fixture.status === 'played' && fixture.score) {
      const { home: hScore, away: aScore } = fixture.score;
      const myScore = fixture.home ? hScore : aScore;
      const oppScore = fixture.home ? aScore : hScore;

      if (myScore > oppScore) return <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />; // Win
      if (myScore < oppScore) return <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />; // Loss
      return <div className="w-3 h-3 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]" />; // Draw
    }
    return <div className="w-3 h-3 rounded-full bg-slate-600" />; // Planned
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-6 lg:p-8 font-sans text-slate-100 flex flex-col gap-6">

      {/* Header Section */}
      {/* Header Section */}
      <PagesHeader
        title="Fikstür"
        description="Sezonluk maç programı ve sonuçlar.."
      />

      {/* Main Content: Fixture List */}
      <div className="bg-[#13111c]/90 border border-white/5 rounded-[32px] p-6 md:p-8 flex-1 relative shadow-2xl backdrop-blur-sm">
        {/* List Header */}
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-purple-200 tracking-wide">Fikstür Programı</h2>
          {/* Create Button Removed */}
        </div>

        {/* Matches List */}
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-10 text-slate-500">Yükleniyor...</div>
          ) : fixtures.length === 0 ? (
            <div className="text-center py-10 text-slate-500">Henüz fikstür oluşturulmamış.</div>
          ) : (
            fixtures.map((fixture) => (
              <div
                key={fixture.id}
                className="group flex flex-col md:flex-row items-center justify-between p-4 rounded-2xl bg-[#1a1725] border border-white/5 hover:border-purple-500/30 transition-all duration-300 hover:bg-[#201c2d]"
              >
                {/* Date */}
                <div className="w-full md:w-32 text-slate-400 text-xs font-semibold tracking-wider mb-2 md:mb-0">
                  {format(fixture.date, 'dd.MM.yyyy')}
                </div>

                {/* Teams */}
                <div className="flex-1 flex items-center justify-center md:justify-start gap-8 md:gap-12 w-full">
                  {/* Home Team */}
                  <div className="flex items-center gap-3 w-1/3 justify-end md:justify-start">
                    <div className="w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center shrink-0">
                      {fixture.home ? (
                        user?.teamLogo ? <img src={user.teamLogo} className="w-full h-full object-cover rounded-md" /> : <Shield size={12} className="text-indigo-400" />
                      ) : (
                        <Shield size={12} className="text-slate-500" />
                      )}
                    </div>
                    <span className={`text-sm font-bold truncate ${fixture.home ? 'text-white' : 'text-slate-400'}`}>
                      {fixture.home ? (user?.teamName || 'Takımım') : fixture.opponent}
                    </span>
                  </div>

                  {/* Away Team */}
                  <div className="flex items-center gap-3 w-1/3">
                    <div className="w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center shrink-0">
                      {!fixture.home ? (
                        user?.teamLogo ? <img src={user.teamLogo} className="w-full h-full object-cover rounded-md" /> : <Shield size={12} className="text-indigo-400" />
                      ) : (
                        <Shield size={12} className="text-slate-500" />
                      )}
                    </div>
                    <span className={`text-sm font-bold truncate ${!fixture.home ? 'text-white' : 'text-slate-400'}`}>
                      {!fixture.home ? (user?.teamName || 'Takımım') : fixture.opponent}
                    </span>
                  </div>
                </div>

                {/* League & Score */}
                <div className="flex items-center justify-between w-full md:w-auto mt-3 md:mt-0 gap-6">
                  <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">{fixture.competitionName}</span>

                  <div className="flex items-center gap-3 min-w-[80px] justify-end">
                    {renderStatusIndicator(fixture)}
                    <span className={`text-lg font-black ${fixture.status === 'played' ? 'text-white' : 'text-slate-500'}`}>
                      {fixture.status === 'played' && fixture.score
                        ? `${fixture.score.home} - ${fixture.score.away}`
                        : format(fixture.date, 'HH:mm')}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

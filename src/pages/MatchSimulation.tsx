import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getFixturesForTeam, getMyLeagueId, getLeagueTeams } from '@/services/leagues';
import type { Fixture } from '@/types';
import { UnityPracticeView } from '@/components/unity/UnityPracticeView';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTeam } from '@/services/team';
import { makeMockTeam } from '@/lib/mockTeam';
import { simulateMatch } from '@/lib/practiceSim';
import { MatchReplayView } from '@/components/replay/MatchReplayView';

type DisplayFixture = Fixture & { opponent: string; home: boolean };

export default function MatchSimulation() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [nextFixture, setNextFixture] = useState<DisplayFixture | null>(null);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [homeSel, setHomeSel] = useState<string | null>(null);
  const [awaySel, setAwaySel] = useState<string | null>(null);
  const [localReplayUrl, setLocalReplayUrl] = useState<string | null>(null);
  const [localMatchId, setLocalMatchId] = useState<string | null>(null);
  const [showUnityPractice, setShowUnityPractice] = useState(false);
  const [practiceMatchId, setPracticeMatchId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      try {
        const lid = await getMyLeagueId(user.id);
        if (!lid) {
          setLeagueId(null);
          setNextFixture(null);
          return;
        }
        setLeagueId(lid);
        const [fixtures, teams] = await Promise.all([
          getFixturesForTeam(lid, user.id),
          getLeagueTeams(lid),
        ]);
        setTeams(teams);
        const teamMap = new Map(teams.map((t) => [t.id, t.name]));
        const upcoming = fixtures
          .filter((f) => f.status !== 'played')
          .sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime())[0];
        if (!upcoming) {
          setNextFixture(null);
          return;
        }
        const home = upcoming.homeTeamId === user.id;
        const opponentId = home ? upcoming.awayTeamId : upcoming.homeTeamId;
        setNextFixture({
          ...upcoming,
          opponent: teamMap.get(opponentId) || opponentId,
          home,
        });
        // Defaults for custom sim
        setHomeSel(upcoming.homeTeamId);
        setAwaySel(upcoming.awayTeamId);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const header = (
    <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate('/')}>←</Button>
          <h1 className="text-xl font-bold">Antrenman Maçı (Gelecek Maç)</h1>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen">
        {header}
        <div className="p-4">Yükleniyor…</div>
      </div>
    );
  }

  if (!nextFixture || !leagueId) {
    return (
      <div className="min-h-screen">
        {header}
        <div className="p-4">
          <Card>
            <CardContent className="p-4">
              Yaklaşan maç bulunamadı veya lig bilgisi eksik.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {header}
      <div className="p-4 space-y-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="text-sm">
              <div className="font-semibold">
                {nextFixture.home ? 'Takımım' : nextFixture.opponent} vs {nextFixture.home ? nextFixture.opponent : 'Takımım'}
              </div>
              <div className="text-muted-foreground">Id: {nextFixture.id}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/team-planning')}>Kadroyu Ayarla</Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/fixtures')}>Fikstür</Button>
            </div>
          </CardContent>
        </Card>

        <UnityPracticeView
          matchId={nextFixture.id}
          leagueId={leagueId}
          homeTeamId={nextFixture.homeTeamId}
          awayTeamId={nextFixture.awayTeamId}
        />

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold">Özel Simülasyon (Yerel)</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <div className="text-xs mb-1">Ev Sahibi</div>
                <Select value={homeSel || undefined} onValueChange={(v) => setHomeSel(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Takım seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs mb-1">Deplasman</div>
                <Select value={awaySel || undefined} onValueChange={(v) => setAwaySel(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Takım seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  className="mt-6"
                  disabled={!homeSel || !awaySel || homeSel === awaySel}
                  onClick={async () => {
                    if (!homeSel || !awaySel) return;
                    try {
                      const homeTeam = (await getTeam(homeSel)) || makeMockTeam(homeSel, teams.find((t) => t.id === homeSel)?.name || homeSel);
                      const awayTeam = (await getTeam(awaySel)) || makeMockTeam(awaySel, teams.find((t) => t.id === awaySel)?.name || awaySel);
                      const { replay } = simulateMatch(homeTeam, awayTeam);
                      const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      setLocalReplayUrl(url);
                      setLocalMatchId(replay.meta?.matchId || `LOCAL-${Date.now()}`);
                      setShowUnityPractice(false);
                    } catch (e) {
                      console.warn('[LocalSim] failed', e);
                    }
                  }}
                >
                  Yerel Simülasyonu Başlat
                </Button>
                <Button
                  variant="outline"
                  className="mt-6"
                  disabled={!homeSel || !awaySel || homeSel === awaySel}
                  onClick={() => {
                    if (!homeSel || !awaySel) return;
                    setLocalReplayUrl(null);
                    setLocalMatchId(null);
                    setPracticeMatchId(`PRAC-${homeSel}-${awaySel}-${Date.now()}`);
                    setShowUnityPractice(true);
                  }}
                >
                  Unity’de Aç (Takımlar Seçili)
                </Button>
              </div>
            </div>

            {localReplayUrl && localMatchId && !showUnityPractice && (
              <div className="pt-2">
                <MatchReplayView matchId={localMatchId} replayUrl={localReplayUrl} />
              </div>
            )}

            {showUnityPractice && practiceMatchId && homeSel && awaySel && (
              <div className="pt-2">
                <UnityPracticeView
                  matchId={practiceMatchId}
                  leagueId={leagueId}
                  homeTeamId={homeSel}
                  awayTeamId={awaySel}
                  homeTeamName={teams.find((t) => t.id === homeSel)?.name}
                  awayTeamName={teams.find((t) => t.id === awaySel)?.name}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

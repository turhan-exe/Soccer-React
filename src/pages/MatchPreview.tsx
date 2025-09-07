import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { upcomingMatches } from '@/lib/data';
import { MapPin, Calendar, Users, TrendingUp, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BackButton } from '@/components/ui/back-button';
import { useAuth } from '@/contexts/AuthContext';
import { getTeam } from '@/services/team';
import { getMyLeagueId, getFixturesForTeam } from '@/services/leagues';
import type { Player } from '@/types';

export default function MatchPreview() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const nextMatch = upcomingMatches[0];
  const [teamOverall, setTeamOverall] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState<string | null>(null);
  const [startingEleven, setStartingEleven] = useState<Player[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const team = await getTeam(user.id);
      if (team) {
        const starters = team.players.filter(p => p.squadRole === 'starting');
        setStartingEleven(starters);
        if (starters.length) {
          const avg =
            starters.reduce((sum, p) => sum + p.overall, 0) / starters.length;
          setTeamOverall(Number(avg.toFixed(3)));
        }
      }
      const leagueId = await getMyLeagueId(user.id);
      if (leagueId) {
        const fixtures = await getFixturesForTeam(leagueId, user.id);
        const played = fixtures.filter(f => f.status === 'played' && f.score);
        const last5 = played.slice(-5).map(f => {
          const isHome = f.homeTeamId === user.id;
          const { home, away } = f.score!;
          if (home === away) return 'D';
          return (isHome && home > away) || (!isHome && away > home) ? 'W' : 'L';
        });
        setTeamForm(last5.join(''));
      }
    })();
  }, [user]);

  const handleStartMatch = () => {
    navigate('/match-simulation');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <h1 className="text-xl font-bold">Maç Önizleme</h1>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Match Info */}
        <Card>
          <CardContent className="p-6">
            <div className="text-center mb-6">
              <Badge variant="outline" className="mb-2">{nextMatch.competition}</Badge>
              <div className="text-sm text-muted-foreground mb-4">
                {new Date(nextMatch.date).toLocaleDateString('tr-TR')} • {nextMatch.time}
              </div>
            </div>

            <div className="flex items-center justify-between mb-6">
              <div className="text-center flex-1">
                <div className="text-4xl mb-2">⚽</div>
                <div className="font-bold text-lg">Takımım</div>
                <div className="text-sm text-muted-foreground">Overall: {teamOverall ?? '-'}</div>
                {teamForm && (
                  <div className="text-sm text-muted-foreground">Form: {teamForm}</div>
                )}
              </div>

              <div className="text-center px-6">
                <div className="text-3xl font-bold text-muted-foreground">VS</div>
              </div>

              <div className="text-center flex-1">
                <div className="text-4xl mb-2">{nextMatch.opponentLogo}</div>
                <div className="font-bold text-lg">{nextMatch.opponent}</div>
                <div className="text-sm text-muted-foreground">Overall: 0.889</div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                <span>{nextMatch.venue === 'home' ? 'Ev Sahipliği' : 'Deplasman'}</span>
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <span>Stadyum: Türk Telekom Stadyumu</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Opponent Analysis */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Rakip Analizi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Son Form</h4>
                <div className="flex gap-1">
                  {['G', 'G', 'G', 'B', 'G'].map((result, i) => (
                    <Badge
                      key={i}
                      variant={result === 'G' ? 'default' : result === 'B' ? 'secondary' : 'destructive'}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs"
                    >
                      {result}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Kritik Oyuncular</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 bg-muted rounded">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                        ST
                      </div>
                      <span className="font-medium">Icardi</span>
                    </div>
                    <span className="text-sm text-muted-foreground">15 gol</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted rounded">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                        CM
                      </div>
                      <span className="font-medium">Torreira</span>
                    </div>
                    <span className="text-sm text-muted-foreground">8 asist</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Your Team Lineup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              İlk 11 Özet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground mb-3">
                Formasyon: 4-4-2 • Seçili Oyuncular: {startingEleven.length}/11
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                {startingEleven.slice(0, 4).map(player => (
                  <div key={player.id} className="flex items-center gap-2 p-2 bg-muted rounded text-sm">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                      {player.position}
                    </div>
                    <span>{player.name}</span>
                  </div>
                ))}
              </div>
              
              {startingEleven.length > 4 && (
                <div className="text-center text-sm text-muted-foreground">
                  +{startingEleven.length - 4} diğer oyuncu
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Match Prediction */}
        <Card>
          <CardHeader>
            <CardTitle>Maç Tahmini</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span>Galibiyet Şansı</span>
                <Badge variant="outline">%35</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Beraberlik Şansı</span>
                <Badge variant="outline">%28</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Mağlubiyet Şansı</span>
                <Badge variant="outline">%37</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Start Match Button */}
        <Card>
          <CardContent className="p-6">
            <Button
              onClick={handleStartMatch}
              className="w-full h-12"
              size="lg"
            >
              <Play className="h-5 w-5 mr-2" />
              Maça Başla
            </Button>
            <p className="text-center text-sm text-muted-foreground mt-2">
              Hazır olduğunuzda maç simülasyonunu başlatın
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
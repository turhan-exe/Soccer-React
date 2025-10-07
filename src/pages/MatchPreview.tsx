import React, { useEffect, useMemo, useState } from 'react';
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
import type { Match, Player } from '@/types';

type KeyPlayer = NonNullable<Match['opponentStats']>['keyPlayers'][number];

export default function MatchPreview() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const nextMatch = upcomingMatches[0];
  const [teamOverall, setTeamOverall] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string>('Takımım');
  const [teamLogo, setTeamLogo] = useState<string | null>(null);
  const [startingEleven, setStartingEleven] = useState<Player[]>([]);
  const [showAllKeyPlayers, setShowAllKeyPlayers] = useState(false);
  const [selectedKeyPlayer, setSelectedKeyPlayer] = useState<KeyPlayer | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const team = await getTeam(user.id);
      if (team) {
        setTeamName(team.name);
        setTeamLogo(team.logo && team.logo.trim() ? team.logo : null);
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

  const formatOverall = (value: number | null | undefined) =>
    typeof value === 'number' ? value.toFixed(3) : '-';

  const getValidLogo = (value?: string | null) =>
    value && value.trim() ? value : null;

  const defaultBallLogo = '/Logo/ball.svg';
  const teamLogoSrc =
    getValidLogo(teamLogo) ?? getValidLogo(user?.teamLogo ?? null) ?? defaultBallLogo;
  const opponentLogoSrc = getValidLogo(nextMatch.opponentLogoUrl) ?? defaultBallLogo;

  const keyPlayers = useMemo(
    () => nextMatch.opponentStats?.keyPlayers ?? [],
    [nextMatch.opponentStats?.keyPlayers],
  );

  const visibleKeyPlayers = showAllKeyPlayers ? keyPlayers : keyPlayers.slice(0, 3);
  const remainingPlayerCount = Math.max(keyPlayers.length - visibleKeyPlayers.length, 0);

  useEffect(() => {
    if (!keyPlayers.length) {
      setSelectedKeyPlayer(null);
      setShowAllKeyPlayers(false);
      return;
    }

    setSelectedKeyPlayer(prev => {
      if (prev) {
        const match = keyPlayers.find(player => player.name === prev.name);
        if (match) {
          return match;
        }
      }
      return keyPlayers[0];
    });

    if (keyPlayers.length <= 3) {
      setShowAllKeyPlayers(false);
    }
  }, [keyPlayers]);

  const renderLogo = (
    src: string | null | undefined,
    fallback: React.ReactNode,
    alt: string,
    className = 'h-14 w-14',
    options?: { fallbackClass?: string; ringClass?: string },
  ) => {
    const ringClass = options?.ringClass ?? 'ring-emerald-500';
    const fallbackClass =
      options?.fallbackClass ?? 'bg-emerald-100 text-emerald-800';
    if (src) {
      return (
        <img
          src={src}
          alt={alt}
          className={`${className} rounded-full object-cover ring-2 ${ringClass}`}
        />
      );
    }
    return (
      <div
        className={`${className} rounded-full ${fallbackClass} flex items-center justify-center text-2xl font-semibold`}
      >
        {fallback}
      </div>
    );
  };

  const opponentForm = nextMatch.opponentStats?.form ?? [];

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
                <div className="flex justify-center mb-2">
                  {renderLogo(teamLogoSrc, '⚽', `${teamName} logosu`)}
                </div>
                <div className="font-bold text-lg">{teamName}</div>
                <div className="text-sm text-muted-foreground">
                  Overall: {formatOverall(teamOverall)}
                </div>
                {teamForm && teamForm.length > 0 && (
                  <div className="flex items-center justify-center gap-1 mt-1 text-sm text-muted-foreground">
                    {teamForm.split('').map((result, index) => (
                      <Badge
                        key={`${result}-${index}`}
                        variant={
                          result === 'W'
                            ? 'default'
                            : result === 'D'
                              ? 'secondary'
                              : 'destructive'
                        }
                        className="px-2"
                      >
                        {result}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-center px-6">
                <div className="text-3xl font-bold text-muted-foreground">VS</div>
              </div>

              <div className="text-center flex-1">
                <div className="flex justify-center mb-2">
                  {renderLogo(
                    opponentLogoSrc,
                    nextMatch.opponentLogo ?? '⚽',
                    `${nextMatch.opponent} logosu`,
                    'h-14 w-14',
                    {
                      fallbackClass: 'bg-amber-100 text-amber-900',
                      ringClass: 'ring-amber-500',
                    },
                  )}
                </div>
                <div className="font-bold text-lg">{nextMatch.opponent}</div>
                <div className="text-sm text-muted-foreground">
                  Overall: {formatOverall(nextMatch.opponentStats?.overall ?? null)}
                </div>
                {opponentForm.length > 0 && (
                  <div className="flex items-center justify-center gap-1 mt-1 text-sm text-muted-foreground">
                    {opponentForm.map((result, index) => (
                      <Badge
                        key={`${nextMatch.id}-opponent-${result}-${index}`}
                        variant={
                          result === 'W'
                            ? 'default'
                            : result === 'D'
                              ? 'secondary'
                              : 'destructive'
                        }
                        className="px-2"
                      >
                        {result}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                <span>{nextMatch.venue === 'home' ? 'Ev Sahipliği' : 'Deplasman'}</span>
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <span>Stadyum: {nextMatch.venueName ?? 'Belirlenecek'}</span>
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
                {opponentForm.length > 0 ? (
                  <div className="flex gap-1">
                    {opponentForm.map((result, index) => (
                      <Badge
                        key={`${nextMatch.id}-analysis-${result}-${index}`}
                        variant={
                          result === 'W'
                            ? 'default'
                            : result === 'D'
                              ? 'secondary'
                              : 'destructive'
                        }
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs"
                      >
                        {result}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Rakip form verisi henüz mevcut değil.</p>
                )}
              </div>

              <div>
                <h4 className="font-semibold mb-2">Kritik Oyuncular</h4>
                {keyPlayers.length ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      {visibleKeyPlayers.map(player => {
                        const positionColors: Record<string, string> = {
                          GK: 'bg-slate-500',
                          CB: 'bg-blue-500',
                          LB: 'bg-emerald-500',
                          RB: 'bg-emerald-500',
                          CM: 'bg-green-500',
                          DM: 'bg-teal-500',
                          CAM: 'bg-orange-500',
                          LW: 'bg-yellow-500',
                          RW: 'bg-yellow-500',
                          ST: 'bg-red-500',
                        };
                        const colorClass = positionColors[player.position] ?? 'bg-gray-500';
                        const isSelected = selectedKeyPlayer?.name === player.name;
                        return (
                          <button
                            key={`${player.name}-${player.position}`}
                            type="button"
                            onClick={() => setSelectedKeyPlayer(player)}
                            className={`flex w-full items-center justify-between rounded border p-2 text-left transition ${
                              isSelected
                                ? 'border-emerald-500 bg-emerald-500/10'
                                : 'border-transparent bg-muted hover:border-emerald-200 hover:bg-muted/80'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${colorClass}`}
                              >
                                {player.position}
                              </div>
                              <div>
                                <div className="font-medium leading-tight">{player.name}</div>
                                <div className="text-xs text-muted-foreground">{player.highlight}</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {remainingPlayerCount > 0 && !showAllKeyPlayers && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full border-dashed"
                        onClick={() => setShowAllKeyPlayers(true)}
                      >
                        +{remainingPlayerCount} oyuncu daha göster
                      </Button>
                    )}
                    {selectedKeyPlayer && (
                      <div className="rounded-lg border bg-muted/60 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold">{selectedKeyPlayer.name}</div>
                            <div className="text-xs text-muted-foreground">{selectedKeyPlayer.highlight}</div>
                          </div>
                          <Badge variant="secondary" className="font-semibold">
                            {selectedKeyPlayer.position}
                          </Badge>
                        </div>
                        {selectedKeyPlayer.stats ? (
                          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                            {selectedKeyPlayer.stats.matches !== undefined && (
                              <div className="rounded bg-background/70 p-2 text-center">
                                <dt className="text-xs text-muted-foreground">Maç</dt>
                                <dd className="font-semibold">{selectedKeyPlayer.stats.matches}</dd>
                              </div>
                            )}
                            {selectedKeyPlayer.stats.goals !== undefined && (
                              <div className="rounded bg-background/70 p-2 text-center">
                                <dt className="text-xs text-muted-foreground">Gol</dt>
                                <dd className="font-semibold">{selectedKeyPlayer.stats.goals}</dd>
                              </div>
                            )}
                            {selectedKeyPlayer.stats.assists !== undefined && (
                              <div className="rounded bg-background/70 p-2 text-center">
                                <dt className="text-xs text-muted-foreground">Asist</dt>
                                <dd className="font-semibold">{selectedKeyPlayer.stats.assists}</dd>
                              </div>
                            )}
                            {selectedKeyPlayer.stats.rating !== undefined && (
                              <div className="rounded bg-background/70 p-2 text-center">
                                <dt className="text-xs text-muted-foreground">Maç Reytingi</dt>
                                <dd className="font-semibold">{selectedKeyPlayer.stats.rating.toFixed(1)}</dd>
                              </div>
                            )}
                            {selectedKeyPlayer.stats.cleanSheets !== undefined && (
                              <div className="rounded bg-background/70 p-2 text-center">
                                <dt className="text-xs text-muted-foreground">Gol Yemedi</dt>
                                <dd className="font-semibold">{selectedKeyPlayer.stats.cleanSheets}</dd>
                              </div>
                            )}
                            {selectedKeyPlayer.stats.minutes !== undefined && (
                              <div className="rounded bg-background/70 p-2 text-center">
                                <dt className="text-xs text-muted-foreground">Dakika</dt>
                                <dd className="font-semibold">{selectedKeyPlayer.stats.minutes}</dd>
                              </div>
                            )}
                          </dl>
                        ) : (
                          <p className="mt-3 text-sm text-muted-foreground">
                            Ayrıntılı istatistik bilgisi bulunamadı.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Rakip oyuncu verisi henüz mevcut değil.</p>
                )}
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
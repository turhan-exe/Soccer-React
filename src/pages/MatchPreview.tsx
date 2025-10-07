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
import { getMyLeagueId, getFixturesForTeamSlotAware, getLeagueTeams } from '@/services/leagues';
import type { ClubTeam, Fixture, Match, Player } from '@/types';

type KeyPlayer = NonNullable<Match['opponentStats']>['keyPlayers'][number];

type DisplayFixture = {
  fixture: Fixture;
  leagueId: string;
  opponentId: string;
  opponentName: string;
  home: boolean;
};

const positionOrder: Record<Player['position'], number> = {
  GK: 0,
  LB: 1,
  CB: 2,
  RB: 3,
  LM: 4,
  CM: 5,
  RM: 6,
  CAM: 7,
  LW: 8,
  RW: 9,
  ST: 10,
};

const sortLineupPlayers = (players: Player[]): Player[] =>
  [...players].sort((a, b) => {
    const orderDiff = (positionOrder[a.position] ?? 99) - (positionOrder[b.position] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name, 'tr');
  });

const computeForm = (fixtures: Fixture[], teamId: string): Array<'W' | 'D' | 'L'> => {
  const played = fixtures
    .filter(f => f.status === 'played' && f.score)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return played.slice(-5).map(f => {
    const isHome = f.homeTeamId === teamId;
    const { home, away } = f.score!;
    if (home === away) return 'D';
    const didWin = (isHome && home > away) || (!isHome && away > home);
    return didWin ? 'W' : 'L';
  });
};

const createKeyPlayersFromLineup = (players: Player[]): KeyPlayer[] =>
  [...players]
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 5)
    .map(player => ({
      name: player.name,
      position: player.position,
      highlight: `Genel: ${Math.round(player.overall * 100)}`,
      stats: { rating: Number((player.overall * 10).toFixed(1)) },
    }));

type OutcomeProbabilities = {
  win: number;
  draw: number;
  loss: number;
};

type ProbabilityInputs = {
  teamOverall?: number | null;
  opponentOverall?: number | null;
  teamForm: Array<'W' | 'D' | 'L'>;
  opponentForm: Array<'W' | 'D' | 'L'>;
  venue?: Match['venue'];
};

const formValueMap: Record<'W' | 'D' | 'L', number> = {
  W: 1,
  D: 0,
  L: -1,
};

const calculateFormScore = (form: Array<'W' | 'D' | 'L'>): number => {
  if (!form.length) return 0;
  const total = form.reduce((sum, result) => sum + formValueMap[result], 0);
  return total / form.length;
};

const calculateOutcomeProbabilities = ({
  teamOverall,
  opponentOverall,
  teamForm,
  opponentForm,
  venue,
}: ProbabilityInputs): OutcomeProbabilities => {
  const DEFAULT_OVERALL = 0.75;

  const teamRating = teamOverall ?? DEFAULT_OVERALL;
  const opponentRating = opponentOverall ?? DEFAULT_OVERALL;
  const ratingDiff = teamRating - opponentRating;
  const ratingScore = ratingDiff * 6; // amplify 0-1 scale differences

  const formScore = (calculateFormScore(teamForm) - calculateFormScore(opponentForm)) * 1.5;
  const venueBoost = venue === 'home' ? 0.4 : venue === 'away' ? -0.2 : 0;

  const momentum = ratingScore + formScore + venueBoost;

  const winFactor = Math.exp(momentum);
  const lossFactor = Math.exp(-momentum);
  const drawFactor = Math.exp(-Math.abs(momentum) * 0.7 + 0.3);

  const total = winFactor + lossFactor + drawFactor;

  if (!Number.isFinite(total) || total <= 0) {
    return { win: 1 / 3, draw: 1 / 3, loss: 1 / 3 };
  }

  return {
    win: winFactor / total,
    draw: drawFactor / total,
    loss: lossFactor / total,
  };
};

export default function MatchPreview() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fallbackMatch = upcomingMatches[0];
  const [matchInfo, setMatchInfo] = useState<Match>(fallbackMatch);
  const [teamOverall, setTeamOverall] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState<Array<'W' | 'D' | 'L'>>([]);
  const [teamName, setTeamName] = useState<string>('Takımım');
  const [teamLogo, setTeamLogo] = useState<string | null>(null);
  const [startingEleven, setStartingEleven] = useState<Player[]>([]);
  const [showAllKeyPlayers, setShowAllKeyPlayers] = useState(false);
  const [selectedKeyPlayer, setSelectedKeyPlayer] = useState<KeyPlayer | null>(null);
  const [nextFixture, setNextFixture] = useState<DisplayFixture | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<ClubTeam | null>(null);
  const [opponentStartingEleven, setOpponentStartingEleven] = useState<Player[]>([]);
  const [opponentOverall, setOpponentOverall] = useState<number | null>(null);
  const [opponentForm, setOpponentForm] = useState<Array<'W' | 'D' | 'L'>>([]);
  const [showAllMyPlayers, setShowAllMyPlayers] = useState(false);
  const [showAllOpponentPlayers, setShowAllOpponentPlayers] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setMatchInfo(fallbackMatch);
      setTeamName('Takımım');
      setTeamLogo(null);
      setStartingEleven([]);
      setTeamOverall(null);
      setTeamForm([]);
      setNextFixture(null);
      setOpponentTeam(null);
      setOpponentStartingEleven([]);
      setOpponentOverall(null);
      setOpponentForm([]);
      setShowAllMyPlayers(false);
      setShowAllOpponentPlayers(false);
      return () => {};
    }
    (async () => {
      const [team, leagueId] = await Promise.all([
        getTeam(user.id),
        getMyLeagueId(user.id),
      ]);
      if (cancelled) return;

      if (team) {
        setTeamName(team.name);
        setTeamLogo(team.logo && team.logo.trim() ? team.logo : null);
        const starters = sortLineupPlayers(
          team.players.filter(p => p.squadRole === 'starting'),
        );
        const lineup = starters.length ? starters.slice(0, 11) : sortLineupPlayers(team.players).slice(0, 11);
        setStartingEleven(lineup);
        if (lineup.length) {
          const avg = lineup.reduce((sum, p) => sum + p.overall, 0) / lineup.length;
          setTeamOverall(Number(avg.toFixed(3)));
        } else {
          setTeamOverall(null);
        }
      } else {
        setTeamName('Takımım');
        setTeamLogo(null);
        setStartingEleven([]);
        setTeamOverall(null);
      }

      if (!leagueId) {
        setTeamForm([]);
        setNextFixture(null);
        return;
      }

      const [fixtures, teams] = await Promise.all([
        getFixturesForTeamSlotAware(leagueId, user.id),
        getLeagueTeams(leagueId).catch(() => []),
      ]);
      if (cancelled) return;

      setTeamForm(computeForm(fixtures, user.id));

      const upcoming = fixtures
        .filter(f => f.status !== 'played')
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0];

      if (!upcoming) {
        setNextFixture(null);
        return;
      }

      const home = upcoming.homeTeamId === user.id;
      const opponentId = home ? upcoming.awayTeamId : upcoming.homeTeamId;
      const teamMap = new Map(teams.map(teamItem => [teamItem.id, teamItem.name] as const));
      const opponentName = teamMap.get(opponentId) ?? opponentId;

      setNextFixture({
        fixture: upcoming,
        leagueId,
        opponentId,
        opponentName,
        home,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, fallbackMatch]);

  const handleStartMatch = () => {
    navigate('/match-simulation');
  };

  const formatOverall = (value: number | null | undefined) =>
    typeof value === 'number' ? value.toFixed(3) : '-';

  const getValidLogo = (value?: string | null) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const looksLikePath = /^(https?:\/\/|\/|\.\/|\.\.\/|data:image\/)/.test(trimmed);
    const hasImageExtension = /\.(svg|png|jpe?g|webp|gif)$/i.test(trimmed);
    if (looksLikePath || hasImageExtension || trimmed.includes('/')) {
      return trimmed;
    }
    return null;
  };

  const defaultBallLogo = '/Logo/ball.svg';
  const teamLogoSrc =
    getValidLogo(teamLogo) ?? getValidLogo(user?.teamLogo ?? null) ?? defaultBallLogo;

  const opponentLogoSrc =
    getValidLogo(matchInfo.opponentLogoUrl) ??
    getValidLogo(opponentTeam?.logo ?? null) ??
    defaultBallLogo;

  const opponentKeyPlayersFromLineup: KeyPlayer[] = useMemo(() => {
    if (!opponentStartingEleven.length) return [];
    return createKeyPlayersFromLineup(opponentStartingEleven);
  }, [opponentStartingEleven]);

  const keyPlayers = useMemo(() => {
    const base = matchInfo.opponentStats?.keyPlayers ?? [];
    return opponentKeyPlayersFromLineup.length ? opponentKeyPlayersFromLineup : base;
  }, [matchInfo.opponentStats?.keyPlayers, opponentKeyPlayersFromLineup]);

  const visibleKeyPlayers = showAllKeyPlayers ? keyPlayers : keyPlayers.slice(0, 3);
  const remainingPlayerCount = Math.max(keyPlayers.length - visibleKeyPlayers.length, 0);

  useEffect(() => {
    setShowAllMyPlayers(false);
  }, [startingEleven.length]);

  useEffect(() => {
    setShowAllOpponentPlayers(false);
  }, [opponentStartingEleven.length]);

  useEffect(() => {
    if (!nextFixture) {
      setOpponentTeam(null);
      setOpponentStartingEleven([]);
      setOpponentOverall(null);
      setOpponentForm([]);
      setMatchInfo(fallbackMatch);
      return;
    }

    let cancelled = false;

    (async () => {
      const [opponent, opponentFixtures] = await Promise.all([
        getTeam(nextFixture.opponentId).catch(() => null),
        getFixturesForTeamSlotAware(nextFixture.leagueId, nextFixture.opponentId).catch(
          () => [],
        ),
      ]);

      if (cancelled) return;

      setOpponentTeam(opponent);

      let derivedLineup: Player[] = [];
      let derivedOverall: number | null = null;

      if (opponent?.players?.length) {
        const starters = sortLineupPlayers(
          opponent.players.filter(player => player.squadRole === 'starting'),
        );
        derivedLineup = starters.length
          ? starters.slice(0, 11)
          : sortLineupPlayers(opponent.players).slice(0, 11);
        if (derivedLineup.length) {
          const avg =
            derivedLineup.reduce((sum, player) => sum + player.overall, 0) /
            derivedLineup.length;
          derivedOverall = Number(avg.toFixed(3));
        }
        setOpponentStartingEleven(derivedLineup);
        setOpponentOverall(derivedOverall);
      } else {
        setOpponentStartingEleven([]);
        setOpponentOverall(null);
      }

      const derivedForm = computeForm(opponentFixtures, nextFixture.opponentId);
      setOpponentForm(derivedForm);

      const baseMatch = upcomingMatches.find(
        match => match.opponent.toLowerCase() === nextFixture.opponentName.toLowerCase(),
      );

      const matchDate = nextFixture.fixture.date;
      const timeString = matchDate.toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const overallValue =
        derivedOverall ?? baseMatch?.opponentStats?.overall ?? null;

      const keyPlayerValue = derivedLineup.length
        ? createKeyPlayersFromLineup(derivedLineup)
        : baseMatch?.opponentStats?.keyPlayers ?? [];

      const formValue =
        derivedForm.length ? derivedForm : baseMatch?.opponentStats?.form ?? [];

      const opponentLogoEmoji = opponent?.logo && opponent.logo.trim() ? opponent.logo : baseMatch?.opponentLogo ?? '⚽';

      setMatchInfo({
        id: nextFixture.fixture.id,
        opponent: nextFixture.opponentName,
        opponentLogo: opponentLogoEmoji,
        opponentLogoUrl: baseMatch?.opponentLogoUrl,
        date: matchDate.toISOString(),
        time: timeString,
        venue: nextFixture.home ? 'home' : 'away',
        status: 'scheduled',
        competition: baseMatch?.competition ?? 'Lig Maçı',
        venueName: baseMatch?.venueName,
        opponentStats:
          overallValue != null || formValue.length || keyPlayerValue.length
            ? {
                overall: overallValue ?? 0,
                form: formValue,
                keyPlayers: keyPlayerValue,
              }
            : undefined,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [nextFixture, fallbackMatch]);

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

  const opponentFormBadges = opponentForm.length
    ? opponentForm
    : matchInfo.opponentStats?.form ?? [];

  const opponentOverallDisplay =
    typeof opponentOverall === 'number'
      ? opponentOverall
      : matchInfo.opponentStats?.overall ?? null;

  const outcomeProbabilities = useMemo(
    () =>
      calculateOutcomeProbabilities({
        teamOverall,
        opponentOverall: opponentOverallDisplay,
        teamForm,
        opponentForm: opponentFormBadges,
        venue: matchInfo.venue,
      }),
    [teamOverall, opponentOverallDisplay, teamForm, opponentFormBadges, matchInfo.venue],
  );

  const matchDate = new Date(matchInfo.date);

  const visibleMyPlayers = showAllMyPlayers ? startingEleven : startingEleven.slice(0, 4);
  const visibleOpponentPlayers = showAllOpponentPlayers
    ? opponentStartingEleven
    : opponentStartingEleven.slice(0, 4);

  const formatPercentage = (value?: number | null) =>
    typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';

  const formatPlayerOverall = (value: number) => Math.round(value * 100);

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
              <Badge variant="outline" className="mb-2">{matchInfo.competition}</Badge>
              <div className="text-sm text-muted-foreground mb-4">
                {matchDate.toLocaleDateString('tr-TR')} • {matchInfo.time}
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
                {teamForm.length > 0 && (
                  <div className="flex items-center justify-center gap-1 mt-1 text-sm text-muted-foreground">
                    {teamForm.map((result, index) => (
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
                    matchInfo.opponentLogo ?? '⚽',
                    `${matchInfo.opponent} logosu`,
                    'h-14 w-14',
                    {
                      fallbackClass: 'bg-amber-100 text-amber-900',
                      ringClass: 'ring-amber-500',
                    },
                  )}
                </div>
                <div className="font-bold text-lg">{matchInfo.opponent}</div>
                <div className="text-sm text-muted-foreground">
                  Overall: {formatOverall(opponentOverallDisplay)}
                </div>
                {opponentFormBadges.length > 0 && (
                  <div className="flex items-center justify-center gap-1 mt-1 text-sm text-muted-foreground">
                    {opponentFormBadges.map((result, index) => (
                      <Badge
                        key={`${matchInfo.id}-opponent-${result}-${index}`}
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
                <span>{matchInfo.venue === 'home' ? 'Ev Sahipliği' : 'Deplasman'}</span>
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <span>Stadyum: {matchInfo.venueName ?? 'Belirlenecek'}</span>
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
                {opponentFormBadges.length > 0 ? (
                  <div className="flex gap-1">
                    {opponentFormBadges.map((result, index) => (
                      <Badge
                        key={`${matchInfo.id}-analysis-${result}-${index}`}
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

        {/* Opponent Starting XI */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Rakip İlk 11
            </CardTitle>
          </CardHeader>
          <CardContent>
            {opponentStartingEleven.length ? (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Toplam oyuncu: {opponentStartingEleven.length}
                </div>
                <div className="space-y-2">
                  {visibleOpponentPlayers.map(player => (
                    <div
                      key={player.id}
                      className="flex items-center gap-3 rounded border bg-background/60 p-3 text-sm"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-xs font-bold uppercase text-white">
                        {player.position}
                      </div>
                      <div className="flex flex-1 flex-col gap-1">
                        <span className="font-semibold">{player.name}</span>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Genel: {formatPlayerOverall(player.overall)}</span>
                          {player.condition !== undefined && (
                            <span>Form: {formatPercentage(player.condition)}</span>
                          )}
                          {player.motivation !== undefined && (
                            <span>Motivasyon: {formatPercentage(player.motivation)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {opponentStartingEleven.length > visibleOpponentPlayers.length && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed"
                    onClick={() => setShowAllOpponentPlayers(prev => !prev)}
                  >
                    {showAllOpponentPlayers
                      ? 'Daha az oyuncu göster'
                      : `İlk 11'i göster (+${opponentStartingEleven.length - visibleOpponentPlayers.length})`}
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Rakip ilk 11 bilgisi bulunamadı.</p>
            )}
          </CardContent>
        </Card>

        {/* Your Team Lineup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Takımımın İlk 11'i
            </CardTitle>
          </CardHeader>
          <CardContent>
            {startingEleven.length ? (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Toplam oyuncu: {startingEleven.length}
                </div>
                <div className="space-y-2">
                  {visibleMyPlayers.map(player => (
                    <div
                      key={player.id}
                      className="flex items-center gap-3 rounded border bg-background/60 p-3 text-sm"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold uppercase text-white">
                        {player.position}
                      </div>
                      <div className="flex flex-1 flex-col gap-1">
                        <span className="font-semibold">{player.name}</span>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Genel: {formatPlayerOverall(player.overall)}</span>
                          {player.condition !== undefined && (
                            <span>Form: {formatPercentage(player.condition)}</span>
                          )}
                          {player.motivation !== undefined && (
                            <span>Motivasyon: {formatPercentage(player.motivation)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {startingEleven.length > visibleMyPlayers.length && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed"
                    onClick={() => setShowAllMyPlayers(prev => !prev)}
                  >
                    {showAllMyPlayers
                      ? 'Daha az oyuncu göster'
                      : `İlk 11'i göster (+${startingEleven.length - visibleMyPlayers.length})`}
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">İlk 11 henüz belirlenmedi.</p>
            )}
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
                <Badge variant="outline">{formatPercentage(outcomeProbabilities.win)}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Beraberlik Şansı</span>
                <Badge variant="outline">{formatPercentage(outcomeProbabilities.draw)}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Mağlubiyet Şansı</span>
                <Badge variant="outline">{formatPercentage(outcomeProbabilities.loss)}</Badge>
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
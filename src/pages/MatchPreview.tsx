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
import { formatRatingLabel, normalizeRatingTo100, normalizeRatingTo100OrNull } from '@/lib/player';
import { useTeamBudget } from '@/hooks/useTeamBudget';
import { Shield } from 'lucide-react';

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
      highlight: `Genel: ${formatRatingLabel(player.overall)}`,
      stats: { rating: Number((normalizeRatingTo100(player.overall) / 10).toFixed(1)) },
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
  const { budget } = useTeamBudget();
  const fallbackMatch = upcomingMatches[0];
  const [matchInfo, setMatchInfo] = useState<Match>(fallbackMatch);
  const [teamOverall, setTeamOverall] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState<Array<'W' | 'D' | 'L'>>([]);
  const [teamName, setTeamName] = useState<string>('Takımım');
  const [teamLogo, setTeamLogo] = useState<string | null>(null);
  const [teamStadiumName, setTeamStadiumName] = useState<string | null>(null);
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
      setTeamStadiumName(null);
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
      return () => { };
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
        const trimmedStadium = team.stadium?.name?.trim();
        setTeamStadiumName(trimmedStadium?.length ? trimmedStadium : null);
        const starters = sortLineupPlayers(
          team.players.filter(p => p.squadRole === 'starting'),
        );
        const lineup = starters.length ? starters.slice(0, 11) : sortLineupPlayers(team.players).slice(0, 11);
        setStartingEleven(lineup);
        if (lineup.length) {
          const avg = lineup.reduce((sum, p) => sum + p.overall, 0) / lineup.length;
          setTeamOverall(normalizeRatingTo100(avg));
        } else {
          setTeamOverall(null);
        }
      } else {
        setTeamName('Takımım');
        setTeamLogo(null);
        setTeamStadiumName(null);
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
    typeof value === 'number' ? formatRatingLabel(value) : '-';

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
          derivedOverall = normalizeRatingTo100(avg);
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

      const fallbackOverall = normalizeRatingTo100OrNull(baseMatch?.opponentStats?.overall);
      const overallValue = derivedOverall ?? fallbackOverall ?? null;

      const keyPlayerValue = derivedLineup.length
        ? createKeyPlayersFromLineup(derivedLineup)
        : baseMatch?.opponentStats?.keyPlayers ?? [];

      const formValue =
        derivedForm.length ? derivedForm : baseMatch?.opponentStats?.form ?? [];

      const opponentLogoEmoji = opponent?.logo && opponent.logo.trim() ? opponent.logo : baseMatch?.opponentLogo ?? '⚽';
      const opponentStadiumName = opponent?.stadium?.name?.trim();
      const fallbackVenueName = baseMatch?.venueName;
      const resolvedVenueName = nextFixture.home
        ? teamStadiumName ?? fallbackVenueName
        : (opponentStadiumName?.length ? opponentStadiumName : null) ?? fallbackVenueName;

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
        venueName: resolvedVenueName ?? undefined,
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
  }, [nextFixture, fallbackMatch, teamStadiumName]);

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

  const formatPlayerOverall = (value: number) => formatRatingLabel(value);

  return (
    <div className="min-h-screen bg-[#14151f] p-4 text-slate-100 pb-24 font-sans">
      {/* Header */}
      <div className="mx-auto max-w-5xl mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#1e202b] p-4 rounded-2xl border border-white/5 shadow-lg">
          <div className="flex items-center gap-4">
            <BackButton />
            <div>
              <h1 className="text-2xl font-bold text-white">Maç Önizleme</h1>
              <p className="text-sm text-slate-400">Yaklaşan müsabaka detayları ve rakip analizi</p>
            </div>
          </div>

          {/* Team Info Card (Top Right) */}
          <div className="flex items-center gap-4 bg-[#14151f] px-4 py-3 rounded-xl border border-white/5">
            <div className="w-10 h-10 rounded-full bg-[#2a2c3a] flex items-center justify-center border border-white/10">
              {renderLogo(teamLogoSrc, <Shield className="w-5 h-5 text-slate-400" />, 'Takım Logo', 'w-10 h-10')}
            </div>
            <div>
              <div className="text-sm font-bold text-white">{teamName}</div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Bütçe</span>
                <div className="h-3 w-[1px] bg-white/10"></div>
                <span className="text-emerald-400 font-mono">{(budget ?? 0).toLocaleString()} $</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-6">
        {/* Match Info Card */}
        <div className="relative overflow-hidden rounded-[2rem] bg-[#1e202b] border border-white/5 shadow-2xl p-6 md:p-10">
          {/* Background Effects */}
          <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[100%] bg-blue-600/5 blur-[100px] rounded-full"></div>
            <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[100%] bg-purple-600/5 blur-[100px] rounded-full"></div>
          </div>

          <div className="relative z-10 flex flex-col items-center">
            {/* Competition Badge */}
            <div className="mb-6">
              <span className="px-4 py-1.5 rounded-full bg-[#2a2c3a] border border-white/10 text-xs font-bold text-slate-300 uppercase tracking-wider shadow-sm">
                {matchInfo.competition || 'Lig Maçı'}
              </span>
            </div>

            {/* Date & Venue */}
            <div className="flex items-center gap-3 text-sm text-slate-400 mb-8 font-medium">
              <span>{matchDate.toLocaleDateString('tr-TR')}</span>
              <span className="w-1 h-1 rounded-full bg-slate-600"></span>
              <span>{matchInfo.venue === 'home' ? 'Ev Sahibi' : 'Deplasman'}</span>
            </div>

            {/* Teams Layout */}
            <div className="flex items-center justify-center w-full gap-8 md:gap-20 mb-10">
              {/* Home Team */}
              <div className="flex flex-col items-center gap-4 w-40">
                <div className="w-24 h-24 md:w-32 md:h-32 p-4 rounded-full bg-white/5 border border-white/5 shadow-[0_0_30px_rgba(0,0,0,0.3)] backdrop-blur-sm flex items-center justify-center">
                  {renderLogo(teamLogoSrc, 'H', 'Takım', 'w-full h-full object-contain', { ringClass: 'ring-0' })}
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-white leading-tight mb-1">{teamName}</div>
                  <Badge variant="secondary" className="bg-[#2a2c3a] text-slate-300 border-white/5 hover:bg-[#343746]">
                    OVR: {formatOverall(teamOverall)}
                  </Badge>
                </div>
              </div>

              {/* VS */}
              <div className="flex flex-col items-center">
                <span className="text-6xl md:text-8xl font-black italic text-white/90 drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)] tracking-tighter" style={{ fontFamily: 'system-ui' }}>VS</span>
                <div className="mt-2 text-2xl font-bold text-white tracking-widest">{matchInfo.time}</div>
              </div>

              {/* Away Team */}
              <div className="flex flex-col items-center gap-4 w-40">
                <div className="w-24 h-24 md:w-32 md:h-32 p-4 rounded-full bg-white/5 border border-white/5 shadow-[0_0_30px_rgba(0,0,0,0.3)] backdrop-blur-sm flex items-center justify-center">
                  {renderLogo(opponentLogoSrc, 'A', 'Rakip', 'w-full h-full object-contain', { ringClass: 'ring-0', fallbackClass: 'bg-white/5 text-slate-400' })}
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-white leading-tight mb-1">{matchInfo.opponent}</div>
                  <Badge variant="secondary" className="bg-[#2a2c3a] text-slate-300 border-white/5 hover:bg-[#343746]">
                    OVR: {formatOverall(opponentOverallDisplay)}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Stadium */}
            <div className="flex items-center gap-2 text-slate-400 bg-white/5 px-5 py-2 rounded-full border border-white/5">
              <MapPin className="w-4 h-4" />
              <span className="text-sm font-medium">{matchInfo.venueName ?? 'Stadyum: Belirlenecek'}</span>
            </div>
          </div>
        </div>

        {/* Analysis Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Opponent Analysis */}
          <Card className="bg-[#1e202b] border-white/5 shadow-lg">
            <CardHeader className="border-b border-white/5 pb-4">
              <CardTitle className="flex items-center gap-2 text-lg text-white">
                <TrendingUp className="h-5 w-5 text-amber-500" />
                Rakip Analizi
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wider">Son Form</h4>
                  {opponentFormBadges.length > 0 ? (
                    <div className="flex gap-2">
                      {opponentFormBadges.map((result, index) => (
                        <div
                          key={`opp-form-${index}`}
                          className={`
                                                w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shadow-md border border-white/5
                                                ${result === 'W' ? 'bg-emerald-500/20 text-emerald-400' :
                              result === 'D' ? 'bg-slate-500/20 text-slate-400' :
                                'bg-red-500/20 text-red-400'}
                                            `}
                        >
                          {result}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Veri yok</p>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wider">Kritik Oyuncular</h4>
                  {keyPlayers.length ? (
                    <div className="space-y-2">
                      {visibleKeyPlayers.map(player => (
                        <div key={player.name} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors cursor-pointer" onClick={() => setSelectedKeyPlayer(player)}>
                          <div className="flex items-center gap-3">
                            <Badge className="bg-[#2a2c3a] text-slate-300 border-white/5 w-8 h-8 flex items-center justify-center p-0">{player.position}</Badge>
                            <div>
                              <div className="font-semibold text-white text-sm">{player.name}</div>
                              <div className="text-[11px] text-slate-400">{player.highlight}</div>
                            </div>
                          </div>
                          {/* Mini Rating Bar or Value if available */}
                          {player.stats?.rating && (
                            <div className="text-sm font-bold text-amber-500">{player.stats.rating}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Veri yok</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Lineup Analysis (Opponent) */}
          <Card className="bg-[#1e202b] border-white/5 shadow-lg">
            <CardHeader className="border-b border-white/5 pb-4">
              <CardTitle className="flex items-center gap-2 text-lg text-white">
                <Users className="h-5 w-5 text-blue-500" />
                Rakip İlk 11 Tahmini
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {opponentStartingEleven.length ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-2">
                    {visibleOpponentPlayers.map(player => (
                      <div key={player.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 border border-transparent hover:border-white/10 transition-colors">
                        <div className="w-8 h-8 rounded-full bg-[#2a2c3a] flex items-center justify-center text-[10px] font-bold text-slate-300 border border-white/5">
                          {player.position}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-white">{player.name}</div>
                          <div className="text-xs text-slate-500">Reyting: {formatPlayerOverall(player.overall)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {opponentStartingEleven.length > 4 && (
                    <Button variant="ghost" className="w-full text-slate-400 hover:text-white hover:bg-white/5 text-xs h-8" onClick={() => setShowAllOpponentPlayers(!showAllOpponentPlayers)}>
                      {showAllOpponentPlayers ? 'Daha Az Göster' : 'Tüm Kadroyu Göster'}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Users className="w-10 h-10 text-slate-700 mb-3" />
                  <p className="text-slate-500 text-sm">Muhtemel 11 henüz belli değil.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

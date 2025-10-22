import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import {
  Users,
  UserPlus,
  Calendar,
  Trophy,
  Dumbbell,
  Play,
  History,
  DollarSign,
  Settings,
  ShoppingCart,
  Star,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getMyLeagueId,
  listLeagueStandings,
  getFixturesForTeam,
  getLeagueTeams,
} from '@/services/leagues';
import { getTeam } from '@/services/team';
import { upcomingMatches } from '@/lib/data';
import type { Fixture } from '@/types';
import '@/styles/nostalgia-theme.css';
import { formatRatingLabel, normalizeRatingTo100, normalizeRatingTo100OrNull } from '@/lib/player';

const menuItems = [
  { id: 'team-planning', label: 'Takim Plani', icon: Users, accent: 'sky' },
  { id: 'youth', label: 'Altyapi', icon: UserPlus, accent: 'emerald' },
  { id: 'transfer-market', label: 'Transfer Pazari', icon: ShoppingCart, accent: 'teal' },
  { id: 'fixtures', label: 'Fikstur', icon: Calendar, accent: 'violet' },
  { id: 'leagues', label: 'Ligler', icon: Trophy, accent: 'gold' },
  { id: 'training', label: 'Antrenman', icon: Dumbbell, accent: 'orange' },
  { id: 'match-preview', label: 'Mac Onizleme', icon: Play, accent: 'rose' },
  { id: 'match-simulation', label: 'Mac Simulasyonu', icon: Play, accent: 'purple' },
  { id: 'match-history', label: 'Gecmis Maclar', icon: History, accent: 'slate' },
  { id: 'finance', label: 'Finans', icon: DollarSign, accent: 'cyan' },
  { id: 'settings', label: 'Ayarlar', icon: Settings, accent: 'teal' },
  { id: 'legend-pack', label: 'Nostalji Paket', icon: Star, accent: 'pink' },
];

type FormBadge = 'W' | 'D' | 'L';

type MatchHighlightClub = {
  name: string;
  logo?: string | null;
  logoUrl?: string | null;
  overall?: number | null;
  form: FormBadge[];
};

type MatchHighlight = {
  competition: string;
  dateText: string;
  timeText: string;
  venue: 'home' | 'away';
  venueName?: string;
  team: MatchHighlightClub;
  opponent: MatchHighlightClub;
};

const computeForm = (fixtures: Fixture[], teamId: string): FormBadge[] => {
  const played = fixtures
    .filter(fixture => fixture.status === 'played' && fixture.score)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return played.slice(-5).map(fixture => {
    const isHome = fixture.homeTeamId === teamId;
    const { home, away } = fixture.score!;
    if (home === away) return 'D';
    const didWin = (isHome && home > away) || (!isHome && away > home);
    return didWin ? 'W' : 'L';
  });
};

const calculateTeamOverall = (players?: { overall: number; squadRole?: string }[] | null): number | null => {
  if (!players?.length) return null;
  const starters = players.filter(player => player.squadRole === 'starting');
  const pool = starters.length ? starters : players;
  if (!pool.length) return null;
  const average = pool.reduce((sum, player) => sum + player.overall, 0) / pool.length;
  return normalizeRatingTo100(average);
};

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

export default function MainMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [leaguePosition, setLeaguePosition] = useState<number | null>(null);
  const [leaguePoints, setLeaguePoints] = useState<number | null>(null);
  const [hoursToNextMatch, setHoursToNextMatch] = useState<number | null>(null);
  const [matchHighlight, setMatchHighlight] = useState<MatchHighlight | null>(null);
  const [areActionsVisible, setAreActionsVisible] = useState(false);
  const interactionSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const node = interactionSurfaceRef.current;
    if (!node) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      pointerIdRef.current = event.pointerId;
      startPointRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId || !startPointRef.current) {
        return;
      }

      const deltaX = event.clientX - startPointRef.current.x;
      const deltaY = event.clientY - startPointRef.current.y;

      if (Math.abs(deltaX) <= 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) {
        return;
      }

      if (deltaX < 0) {
        setAreActionsVisible(true);
      } else {
        setAreActionsVisible(false);
      }

      pointerIdRef.current = null;
      startPointRef.current = null;
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (pointerIdRef.current === event.pointerId) {
        pointerIdRef.current = null;
        startPointRef.current = null;
      }
    };

    node.addEventListener('pointerdown', handlePointerDown);
    node.addEventListener('pointermove', handlePointerMove);
    node.addEventListener('pointerup', handlePointerEnd);
    node.addEventListener('pointercancel', handlePointerEnd);

    return () => {
      node.removeEventListener('pointerdown', handlePointerDown);
      node.removeEventListener('pointermove', handlePointerMove);
      node.removeEventListener('pointerup', handlePointerEnd);
      node.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, []);

  useEffect(() => {
    if (!areActionsVisible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAreActionsVisible(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [areActionsVisible]);

  useEffect(() => {
    const loadQuickStats = async () => {
      if (!user) {
        setLeaguePosition(null);
        setLeaguePoints(null);
        setHoursToNextMatch(null);
        const fallbackMatch = upcomingMatches[0];
        if (fallbackMatch) {
          const fallbackDate = new Date(`${fallbackMatch.date}T${fallbackMatch.time ?? '00:00'}`);
          const hasValidDate = !Number.isNaN(fallbackDate.getTime());
          setMatchHighlight({
            competition: fallbackMatch.competition ?? 'Lig Maci',
            dateText: hasValidDate
              ? fallbackDate.toLocaleDateString('tr-TR')
              : fallbackMatch.date,
            timeText: fallbackMatch.time
              ?? (hasValidDate
                ? fallbackDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
                : ''),
            venue: fallbackMatch.venue ?? 'home',
            venueName: fallbackMatch.venueName,
            team: {
              name: 'Takimim',
              logo: null,
              form: [],
              overall: null,
            },
            opponent: {
              name: fallbackMatch.opponent,
              logo: fallbackMatch.opponentLogo,
              logoUrl: fallbackMatch.opponentLogoUrl,
              form: fallbackMatch.opponentStats?.form ?? [],
              overall: normalizeRatingTo100OrNull(fallbackMatch.opponentStats?.overall),
            },
          });
        } else {
          setMatchHighlight(null);
        }
        return;
      }
      try {
        const leagueId = await getMyLeagueId(user.id);
        if (!leagueId) {
          setLeaguePosition(null);
          setLeaguePoints(null);
          setHoursToNextMatch(null);
          setMatchHighlight(null);
          return;
        }

        const [standings, fixtures, leagueTeams, myTeam] = await Promise.all([
          listLeagueStandings(leagueId),
          getFixturesForTeam(leagueId, user.id),
          getLeagueTeams(leagueId).catch(() => []),
          getTeam(user.id).catch(() => null),
        ]);

        const myIndex = standings.findIndex((s) => s.id === user.id);
        if (myIndex >= 0) {
          setLeaguePosition(myIndex + 1);
          setLeaguePoints(standings[myIndex].Pts);
        } else {
          setLeaguePosition(null);
          setLeaguePoints(null);
        }

        const upcomingFixtures = fixtures
          .filter((fixture) => fixture.status !== 'played')
          .sort((a, b) => a.date.getTime() - b.date.getTime());
        const nextFixture = upcomingFixtures[0];

        if (nextFixture && nextFixture.date) {
          const matchTime = nextFixture.date.getTime();
          const now = Date.now();
          const diffMs = Math.max(0, matchTime - now);
          const hours = Math.ceil(diffMs / 36e5);
          setHoursToNextMatch(hours);
        } else {
          setHoursToNextMatch(null);
        }

        const teamOverall = calculateTeamOverall(myTeam?.players ?? null);
        const teamForm = computeForm(fixtures, user.id);
        const teamName = myTeam?.name ?? user.teamName ?? 'Takimim';
        const teamLogo = myTeam?.logo ?? user.teamLogo ?? null;

        const createHighlightFromFallback = () => {
          const fallbackMatch = upcomingMatches[0];
          if (!fallbackMatch) {
            setMatchHighlight(null);
            return;
          }
          const fallbackDate = new Date(`${fallbackMatch.date}T${fallbackMatch.time ?? '00:00'}`);
          const hasValidDate = !Number.isNaN(fallbackDate.getTime());
          const dateText = hasValidDate
            ? fallbackDate.toLocaleDateString('tr-TR')
            : fallbackMatch.date;
          const timeText = fallbackMatch.time
            ?? (hasValidDate
              ? fallbackDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
              : '');
          setMatchHighlight({
            competition: fallbackMatch.competition ?? 'Lig Maci',
            dateText,
            timeText,
            venue: fallbackMatch.venue ?? 'home',
            venueName: fallbackMatch.venueName,
            team: {
              name: teamName,
              logo: teamLogo,
              form: teamForm,
              overall: teamOverall,
            },
            opponent: {
              name: fallbackMatch.opponent,
              logo: fallbackMatch.opponentLogo,
              logoUrl: fallbackMatch.opponentLogoUrl,
              form: fallbackMatch.opponentStats?.form ?? [],
              overall: normalizeRatingTo100OrNull(fallbackMatch.opponentStats?.overall),
            },
          });
        };

        if (!nextFixture) {
          createHighlightFromFallback();
          return;
        }

        const isHome = nextFixture.homeTeamId === user.id;
        const opponentId = isHome ? nextFixture.awayTeamId : nextFixture.homeTeamId;
        const teamMap = new Map(leagueTeams.map((teamItem) => [teamItem.id, teamItem.name] as const));
        const opponentName = opponentId ? teamMap.get(opponentId) ?? opponentId : 'Rakip';

        let opponentOverall: number | null = null;
        let opponentForm: FormBadge[] = [];
        let opponentLogo: string | null | undefined = null;
        let opponentLogoUrl: string | null | undefined = null;

        if (opponentId) {
          try {
            const [opponentTeam, opponentFixtures] = await Promise.all([
              getTeam(opponentId).catch(() => null),
              getFixturesForTeam(leagueId, opponentId).catch(() => []),
            ]);

            opponentOverall = calculateTeamOverall(opponentTeam?.players ?? null);
            opponentForm = opponentFixtures.length ? computeForm(opponentFixtures, opponentId) : [];
            opponentLogo = opponentTeam?.logo ?? null;
          } catch (error) {
            console.warn('[MainMenu] opponent info load failed', error);
          }
        }

        const fallbackMatch = upcomingMatches.find(
          (match) => match.opponent.toLowerCase() === opponentName.toLowerCase(),
        );

        if (!opponentLogo && fallbackMatch?.opponentLogo) {
          opponentLogo = fallbackMatch.opponentLogo;
        }
        if (fallbackMatch?.opponentLogoUrl) {
          opponentLogoUrl = fallbackMatch.opponentLogoUrl;
        }
        if (!opponentForm.length && fallbackMatch?.opponentStats?.form?.length) {
          opponentForm = fallbackMatch.opponentStats.form;
        }
        if (opponentOverall == null && fallbackMatch?.opponentStats?.overall != null) {
          opponentOverall = normalizeRatingTo100(fallbackMatch.opponentStats.overall);
        }

        const matchDate = nextFixture.date;
        const dateText = matchDate.toLocaleDateString('tr-TR');
        const timeText = matchDate.toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
        });

        setMatchHighlight({
          competition: fallbackMatch?.competition ?? 'Lig Maci',
          dateText,
          timeText,
          venue: isHome ? 'home' : 'away',
          venueName: fallbackMatch?.venueName,
          team: {
            name: teamName,
            logo: teamLogo,
            form: teamForm,
            overall: teamOverall,
          },
          opponent: {
            name: opponentName,
            logo: opponentLogo,
            logoUrl: opponentLogoUrl,
            form: opponentForm,
            overall: opponentOverall,
          },
        });
      } catch (error) {
        console.warn('[MainMenu] quick stats load failed', error);
        const fallbackMatch = upcomingMatches[0];
        if (user && fallbackMatch) {
          const fallbackDate = new Date(`${fallbackMatch.date}T${fallbackMatch.time ?? '00:00'}`);
          const hasValidDate = !Number.isNaN(fallbackDate.getTime());
          setMatchHighlight({
            competition: fallbackMatch.competition ?? 'Lig Maci',
            dateText: hasValidDate
              ? fallbackDate.toLocaleDateString('tr-TR')
              : fallbackMatch.date,
            timeText: fallbackMatch.time
              ?? (hasValidDate
                ? fallbackDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
                : ''),
            venue: fallbackMatch.venue ?? 'home',
            venueName: fallbackMatch.venueName,
            team: {
              name: user.teamName ?? 'Takimim',
              logo: user.teamLogo ?? null,
              form: [],
              overall: null,
            },
            opponent: {
              name: fallbackMatch.opponent,
              logo: fallbackMatch.opponentLogo,
              logoUrl: fallbackMatch.opponentLogoUrl,
              form: fallbackMatch.opponentStats?.form ?? [],
              overall: normalizeRatingTo100OrNull(fallbackMatch.opponentStats?.overall),
            },
          });
        } else {
          setMatchHighlight(null);
        }
      }
    };

    loadQuickStats();
  }, [user]);

  const handleMenuClick = (itemId: string) => {
    navigate(`/${itemId}`);
  };

  const hideActions = () => setAreActionsVisible(false);

  const toggleActionsVisibility = () => {
    setAreActionsVisible((previous) => !previous);
  };

  const renderMenuCard = (item: (typeof menuItems)[number]) => (
    <Card
      key={item.id}
      className={`nostalgia-card nostalgia-card--${item.accent} cursor-pointer`}
      onClick={() => handleMenuClick(item.id)}
    >
      <span className="nostalgia-card__halo" aria-hidden />
      <CardContent className="nostalgia-card__content">
        <div className={`nostalgia-menu-icon nostalgia-menu-icon--${item.accent}`}>
          <item.icon />
        </div>
        <h3 className="nostalgia-card__label">{item.label}</h3>
      </CardContent>
    </Card>
  );

  const renderLogo = (logo?: string | null, fallback?: string, alt?: string) => {
    const src = getValidLogo(logo);
    if (src) {
      return (
        <img
          src={src}
          alt={alt ?? 'Takim logosu'}
          className="nostalgia-match-team__emblem-image"
        />
      );
    }
    const display = logo && logo.trim() ? logo : fallback ?? 'TM';
    return (
      <div className="nostalgia-match-team__emblem-fallback" aria-hidden>
        {display}
      </div>
    );
  };

  const formatOverall = (value?: number | null) =>
    typeof value === 'number' && Number.isFinite(value) ? formatRatingLabel(value) : '-';

  const formatForm = (form: FormBadge[]) => (form.length ? form.join('') : '-');

  const highlightElement = (
    <section
      className={`nostalgia-match-highlight${
        matchHighlight ? '' : ' nostalgia-match-highlight--empty'
      }`}
      aria-label="Sonraki mac paneli"
    >
      <div className="nostalgia-match-highlight__overlay" aria-hidden />
      {matchHighlight ? (
        <>
          <div className="nostalgia-match-highlight__header">
            <span className="nostalgia-match-highlight__badge">{matchHighlight.competition}</span>
            <div className="nostalgia-match-highlight__datetime">
              {matchHighlight.dateText}
              {matchHighlight.timeText ? ` - ${matchHighlight.timeText}` : ''}
            </div>
          </div>

          <div className="nostalgia-match-highlight__body">
            <div className="nostalgia-match-team">
              <div className="nostalgia-match-team__emblem">
                {renderLogo(
                  matchHighlight.team.logoUrl ?? matchHighlight.team.logo,
                  'TM',
                  `${matchHighlight.team.name} logosu`,
                )}
              </div>
              <div className="nostalgia-match-team__name">{matchHighlight.team.name}</div>
              <div className="nostalgia-match-team__meta">
                Overall: {formatOverall(matchHighlight.team.overall)}
              </div>
              <div className="nostalgia-match-team__meta">
                Form: {formatForm(matchHighlight.team.form)}
              </div>
            </div>
            <div className="nostalgia-match-highlight__vs">VS</div>

            <div className="nostalgia-match-team">
              <div className="nostalgia-match-team__emblem">
                {renderLogo(
                  matchHighlight.opponent.logoUrl ?? matchHighlight.opponent.logo,
                  'TM',
                  `${matchHighlight.opponent.name} logosu`,
                )}
              </div>
              <div className="nostalgia-match-team__name">{matchHighlight.opponent.name}</div>
              <div className="nostalgia-match-team__meta">
                Overall: {formatOverall(matchHighlight.opponent.overall)}
              </div>
              <div className="nostalgia-match-team__meta">
                Form: {formatForm(matchHighlight.opponent.form)}
              </div>
            </div>
          </div>

          <div className="nostalgia-match-highlight__footer">
            <span>{matchHighlight.venue === 'home' ? 'Ev Sahipligi' : 'Deplasman'}</span>
            <span>Stadyum: {matchHighlight.venueName ?? 'Belirlenecek'}</span>
          </div>
        </>
      ) : (
        <div className="nostalgia-match-highlight__empty">
          <h2>Sonraki mac bilgisi hazirlaniyor</h2>
          <p>Fikstur guncellendiginde ozet burada goruntulenecek.</p>
        </div>
      )}
    </section>
  );

  return (
    <div className="nostalgia-screen nostalgia-screen--main-menu">
      <div className="nostalgia-screen__gradient" aria-hidden />
      <div className="nostalgia-screen__orb nostalgia-screen__orb--left" aria-hidden />
      <div className="nostalgia-screen__orb nostalgia-screen__orb--right" aria-hidden />
      <div className="nostalgia-screen__noise" aria-hidden />
      <div className="nostalgia-screen__content nostalgia-screen__content--main-menu">
        <div
          ref={interactionSurfaceRef}
          className={`nostalgia-main-menu${areActionsVisible ? ' nostalgia-main-menu--actions-visible' : ''}`}
        >
          <div className="nostalgia-main-menu__core">
            <div className="nostalgia-main-menu__match" role="presentation">
              {highlightElement}
            </div>
            <section
              className="nostalgia-quick-panel nostalgia-main-menu__quick"
              aria-label="Hizli bakis paneli"
            >
              <h2 className="nostalgia-quick-panel__title">Hizli Bakis</h2>
              <div className="nostalgia-quick-grid">
                <div className="nostalgia-quick-card">
                  <span className="nostalgia-quick-card__value text-emerald-300">
                    {leaguePosition ?? '-'}
                    {leaguePosition ? '.' : ''}
                  </span>
                  <span className="nostalgia-quick-card__label">Lig Sirasi</span>
                </div>
                <div className="nostalgia-quick-card">
                  <span className="nostalgia-quick-card__value text-sky-300">{leaguePoints ?? '-'}</span>
                  <span className="nostalgia-quick-card__label">Puan</span>
                </div>
                <div className="nostalgia-quick-card">
                  <span className="nostalgia-quick-card__value text-fuchsia-300">{hoursToNextMatch ?? '-'}</span>
                  <span className="nostalgia-quick-card__label">Saat Sonra</span>
                </div>
              </div>
            </section>
          </div>

          <aside
            id="nostalgia-main-menu-actions"
            className={`nostalgia-main-menu__actions${
              areActionsVisible ? ' nostalgia-main-menu__actions--visible' : ''
            }`}
            aria-hidden={!areActionsVisible}
          >
            <div className="nostalgia-main-menu__actions-grid">
              {menuItems.map(renderMenuCard)}
            </div>
          </aside>

          <button
            type="button"
            className="nostalgia-main-menu__actions-handle"
            onClick={toggleActionsVisibility}
            aria-expanded={areActionsVisible}
            aria-controls="nostalgia-main-menu-actions"
          >
            <span className="sr-only">
              {areActionsVisible ? 'Kisayollari gizle' : 'Kisayollari goster'}
            </span>
            <span className="nostalgia-main-menu__actions-icon" aria-hidden />
          </button>

          {areActionsVisible ? (
            <button
              type="button"
              className="nostalgia-main-menu__scrim nostalgia-main-menu__scrim--visible"
              onClick={hideActions}
              aria-label="Kisayollari gizle"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}



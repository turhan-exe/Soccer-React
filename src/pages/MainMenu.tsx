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
import { useViewportScale } from '@/hooks/use-viewport-scale';

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

  const shouldScaleToViewport = true;
  const [leaguePosition, setLeaguePosition] = useState<number | null>(null);
  const [leaguePoints, setLeaguePoints] = useState<number | null>(null);
  const [hoursToNextMatch, setHoursToNextMatch] = useState<number | null>(null);
  const [matchHighlight, setMatchHighlight] = useState<MatchHighlight | null>(null);
  const [areActionsVisible, setAreActionsVisible] = useState(false);
  const { contentRef, scale } = useViewportScale<HTMLDivElement>(shouldScaleToViewport);
  const scaledStyle = shouldScaleToViewport
    ? ({ '--nostalgia-scale': scale } as React.CSSProperties)
    : undefined;
  const isScaled = shouldScaleToViewport && scale < 0.999;
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const swipeStateRef = useRef({
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    active: false,
    hasDetermined: false,
    isHorizontal: false,
    startedInsideActions: false,
  });

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

  const resetSwipeState = () => {
    swipeStateRef.current.pointerId = null;
    swipeStateRef.current.active = false;
    swipeStateRef.current.hasDetermined = false;
    swipeStateRef.current.isHorizontal = false;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const actionsNode = actionsRef.current;
    const startedInsideActions = actionsNode?.contains(event.target as Node) ?? false;

    swipeStateRef.current.pointerId = event.pointerId;
    swipeStateRef.current.startX = event.clientX;
    swipeStateRef.current.startY = event.clientY;
    swipeStateRef.current.lastX = event.clientX;
    swipeStateRef.current.lastY = event.clientY;
    swipeStateRef.current.active = true;
    swipeStateRef.current.hasDetermined = false;
    swipeStateRef.current.isHorizontal = false;
    swipeStateRef.current.startedInsideActions = startedInsideActions;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = swipeStateRef.current;
    if (!state.active || state.pointerId !== event.pointerId) {
      return;
    }

    state.lastX = event.clientX;
    state.lastY = event.clientY;

    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;

    if (!state.hasDetermined) {
      if (Math.abs(deltaX) > 14 || Math.abs(deltaY) > 14) {
        state.hasDetermined = true;
        state.isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);

        if (!state.isHorizontal) {
          resetSwipeState();
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {}
        }
      }
    }

    if (state.isHorizontal) {
      event.preventDefault();
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = swipeStateRef.current;
    if (!state.active || state.pointerId !== event.pointerId) {
      return;
    }

    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {}

    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);
    const isHorizontalSwipe = absDeltaX > 60 && absDeltaX > absDeltaY;

    if (isHorizontalSwipe) {
      if (deltaX < 0) {
        setAreActionsVisible(true);
      } else if (deltaX > 0) {
        setAreActionsVisible(false);
      }
    } else if (
      areActionsVisible &&
      !state.startedInsideActions &&
      absDeltaX < 10 &&
      absDeltaY < 10
    ) {
      setAreActionsVisible(false);
    }

    resetSwipeState();
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {}
    resetSwipeState();
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

  const renderQuickPanel = (extraClassName?: string) => (
    <section className={`nostalgia-quick-panel${extraClassName ? ` ${extraClassName}` : ''}`}>
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
  );

  const highlightElement = matchHighlight ? (
    <section className="nostalgia-match-highlight">
      <div className="nostalgia-match-highlight__overlay" aria-hidden />
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
    </section>
  ) : (
    <section className="nostalgia-match-highlight nostalgia-match-highlight--empty">
      <div className="nostalgia-match-highlight__overlay" aria-hidden />
      <div className="nostalgia-match-highlight__header">
        <span className="nostalgia-match-highlight__badge">Sonraki Mac</span>
        <div className="nostalgia-match-highlight__datetime">Programlanmis mac bulunmuyor.</div>
      </div>
      <div className="nostalgia-match-highlight__body" aria-hidden>
        <div className="nostalgia-match-team">
          <div className="nostalgia-match-team__name">Hazirlik Devam Ediyor</div>
        </div>
      </div>
      <div className="nostalgia-match-highlight__footer">
        <span>Rakip bekleniyor</span>
        <span>Stadyum: Belirlenecek</span>
      </div>
    </section>
  );

  return (
    <div className="nostalgia-screen nostalgia-main-menu">
      <div className="nostalgia-screen__gradient" aria-hidden />
      <div className="nostalgia-screen__orb nostalgia-screen__orb--left" aria-hidden />
      <div className="nostalgia-screen__orb nostalgia-screen__orb--right" aria-hidden />
      <div className="nostalgia-screen__noise" aria-hidden />
      <div
        className="nostalgia-screen__content-shell"
        data-scale-active={isScaled ? 'true' : 'false'}
        style={scaledStyle}
      >
        <div className="nostalgia-screen__content" ref={contentRef}>
          <div
            className="nostalgia-main-menu__viewport"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerCancel}
            style={{ touchAction: 'pan-y' }}
          >
            <div className="nostalgia-main-menu__hero">
              <div className="nostalgia-main-menu__highlight-wrapper">{highlightElement}</div>
              {renderQuickPanel('nostalgia-quick-panel--pinned')}
            </div>
            <div
              ref={actionsRef}
              id="main-menu-actions"
              className="nostalgia-main-menu__actions"
              data-visible={areActionsVisible ? 'true' : 'false'}
              aria-hidden={areActionsVisible ? 'false' : 'true'}
            >
              <div className="nostalgia-main-menu__actions-grid" role="group" aria-label="Ana menu kisayollari">
                {menuItems.map(renderMenuCard)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



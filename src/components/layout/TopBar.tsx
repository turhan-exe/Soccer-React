import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BatteryCharging,
  Crown,
  Diamond,
  Dumbbell,
  HeartPulse,
  Loader2,
  Smile,
  UserPlus,
  Moon,
  Sun,
  LogOut,
  Bell,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useInventory } from '@/contexts/InventoryContext';
import { getMyLeagueId, getFixturesForTeam } from '@/services/leagues';
import { getTeam } from '@/services/team';
import {
  finalizeExpiredTrainingSession,
  getActiveTraining,
  getUnviewedTrainingCount,
  listenActiveTraining,
} from '@/services/training';
import {
  getYouthCandidates,
  getYouthGenerationAvailability,
  listenYouthCandidates,
  listenYouthGenerationAvailability,
} from '@/services/youth';
import type { KitType } from '@/types';
import { KIT_CONFIG, formatKitEffect } from '@/lib/kits';
import KitUsageDialog from '@/components/kit/KitUsageDialog';
import { toast } from 'sonner';
import { normalizeRatingTo100 } from '@/lib/player';
import '@/styles/nostalgia-theme.css';
import { useSwipeDownReveal, SWIPE_DOWN_DEFAULTS } from '@/hooks/useSwipeDownReveal';

const KIT_ICONS: Record<KitType, { icon: LucideIcon; color: string }> = {
  energy: { icon: BatteryCharging, color: 'text-emerald-500' },
  morale: { icon: Smile, color: 'text-amber-500' },
  health: { icon: HeartPulse, color: 'text-rose-500' },
};

const VISIBILITY_COOLDOWN_MS = 300;
const KIT_ROTATION_INTERVAL_MS = 2000;

export interface TopBarHandle {
  isTopBarVisible: boolean;
  showTopBar: () => void;
  hideTopBar: () => void;
  toggleTopBar: () => void;
}

interface TopBarProps {
  swipeDownThreshold?: number;
  swipeTimeMax?: number;
}

const TopBar = forwardRef<TopBarHandle, TopBarProps>(
  (
    {
      swipeDownThreshold = SWIPE_DOWN_DEFAULTS.threshold,
      swipeTimeMax = SWIPE_DOWN_DEFAULTS.timeMax,
    },
    ref,
  ) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { balance } = useDiamonds();
  const { kits, purchaseKit, isProcessing, vipActive, vipStatus } = useInventory();
  const kitTypes = useMemo(() => Object.keys(KIT_ICONS) as KitType[], []);
  const [activeKit, setActiveKit] = useState<KitType | null>(null);
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const [teamOverall, setTeamOverall] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState<string | null>(null);
  const [displayTeamName, setDisplayTeamName] = useState<string>(user?.teamName ?? 'Takimim');
  const [hasUnseenTrainingResults, setHasUnseenTrainingResults] = useState(false);
  const [isTrainingFacilityAvailable, setIsTrainingFacilityAvailable] = useState(false);
  const [hasYouthCandidates, setHasYouthCandidates] = useState(false);
  const [canGenerateYouthCandidate, setCanGenerateYouthCandidate] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [currentKitIndex, setCurrentKitIndex] = useState(0);
  const [isKitMenuOpen, setIsKitMenuOpen] = useState(false);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const notificationContentRef = useRef<HTMLDivElement | null>(null);
  const lastVisibilityChangeRef = useRef<number>(0);
  const focusFrameRef = useRef<number | null>(null);
  const vipIconClass = vipActive ? 'text-amber-300 drop-shadow' : 'text-slate-400';
  const vipButtonClass = vipActive
    ? 'bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100'
    : 'text-slate-300 hover:text-white hover:bg-white/10';
  const vipPlanName = vipStatus.plan ? vipStatus.plan.toUpperCase() : null;
  const vipTooltip = vipActive
    ? `VIP aktif${vipPlanName ? ` (${vipPlanName})` : ''}`
    : 'VIP paketlerini kesfet';
  const kitCount = kitTypes.length;
  const currentKitType = kitTypes[currentKitIndex] ?? null;

  const setVisibility = useCallback(
    (value: boolean, { force = false }: { force?: boolean } = {}) => {
      setIsVisible((previous) => {
        if (previous === value) {
          return previous;
        }

        const now = Date.now();
        if (!force && now - lastVisibilityChangeRef.current < VISIBILITY_COOLDOWN_MS) {
          return previous;
        }

        lastVisibilityChangeRef.current = now;
        return value;
      });
    },
    [],
  );

  const showTopBar = useCallback(() => {
    setVisibility(true);
  }, [setVisibility]);

  const hideTopBar = useCallback(() => {
    setVisibility(false);
  }, [setVisibility]);

  const forceHideTopBar = useCallback(() => {
    setVisibility(false, { force: true });
  }, [setVisibility]);

  const toggleTopBar = useCallback(() => {
    setVisibility(!isVisible);
  }, [isVisible, setVisibility]);

  useImperativeHandle(
    ref,
    () => ({
      isTopBarVisible: isVisible,
      showTopBar,
      hideTopBar,
      toggleTopBar,
    }),
    [hideTopBar, isVisible, showTopBar, toggleTopBar],
  );

  useSwipeDownReveal({
    onSwipeDown: showTopBar,
    threshold: swipeDownThreshold,
    timeMax: swipeTimeMax,
    disabled: isVisible,
  });

  useEffect(() => {
    return () => {
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isVisible || isKitMenuOpen || kitCount <= 1) {
      return;
    }

    const rotationInterval = window.setInterval(() => {
      setCurrentKitIndex((previous) => (previous + 1) % kitCount);
    }, KIT_ROTATION_INTERVAL_MS);

    return () => {
      window.clearInterval(rotationInterval);
    };
  }, [isVisible, isKitMenuOpen, kitCount]);

  useEffect(() => {
    if (kitCount === 0) {
      return;
    }

    if (currentKitIndex >= kitCount) {
      setCurrentKitIndex(0);
    }
  }, [currentKitIndex, kitCount]);

  useEffect(() => {
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }

    if (!isVisible) {
      return;
    }

    const element = topBarRef.current;
    if (!element) {
      return;
    }

    const focusSelector = [
      '[data-topbar-focus-target]',
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const focusTarget = element.querySelector<HTMLElement>(focusSelector);
    if (!focusTarget) {
      return;
    }

    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusTarget.focus({ preventScroll: true });
      focusFrameRef.current = null;
    });
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const element = topBarRef.current;
      if (!element) {
        return;
      }

      const popoverElement = notificationContentRef.current;
      if (popoverElement && popoverElement.contains(event.target as Node)) {
        return;
      }

      if (!element.contains(event.target as Node)) {
        forceHideTopBar();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [forceHideTopBar, isVisible]);

  useEffect(() => {
    if (!user) {
      setTeamOverall(null);
      setTeamForm(null);
      return;
    }

    let cancelled = false;

    const loadTeamSummary = async () => {
      try {
        const [team, leagueId] = await Promise.all([
          getTeam(user.id),
          getMyLeagueId(user.id),
        ]);

        if (cancelled) return;

        if (team) {
          setDisplayTeamName(team.name || user.teamName || 'Takimim');
          const starters = team.players.filter((player) => player.squadRole === 'starting');
          if (starters.length) {
            const average = starters.reduce((sum, player) => sum + player.overall, 0) / starters.length;
            setTeamOverall(normalizeRatingTo100(average));
          } else {
            setTeamOverall(null);
          }
        } else {
          setDisplayTeamName(user.teamName || 'Takimim');
          setTeamOverall(null);
        }

        if (!leagueId) {
          setTeamForm(null);
          return;
        }

        const fixtures = await getFixturesForTeam(leagueId, user.id);
        if (cancelled) return;

        const played = fixtures.filter((fixture) => fixture.status === 'played' && fixture.score).slice(-5);
        const form = played
          .map((fixture) => {
            const isHome = fixture.homeTeamId === user.id;
            const { home, away } = fixture.score!;
            if (home === away) return 'D';
            const didWin = (isHome && home > away) || (!isHome && away > home);
            return didWin ? 'W' : 'L';
          })
          .join('');

        setTeamForm(form || null);
      } catch (error) {
        console.warn('[TopBar] takim ozeti yuklenemedi', error);
        if (!cancelled) {
          setTeamOverall(null);
          setTeamForm(null);
        }
      }
    };

    loadTeamSummary();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    setDisplayTeamName(user?.teamName ?? 'Takimim');
  }, [user?.teamName]);

  useEffect(() => {
    if (!user) {
      setHasUnseenTrainingResults(false);
      setIsTrainingFacilityAvailable(false);
      setHasYouthCandidates(false);
      setCanGenerateYouthCandidate(false);
      return;
    }

    let cancelled = false;
    let unsubscribeYouth: (() => void) | null = null;
    let unsubscribeTraining: (() => void) | null = null;
    let unsubscribeYouthGeneration: (() => void) | null = null;

    const loadNotifications = async () => {
      try {
        await finalizeExpiredTrainingSession(user.id);
      } catch (error) {
        console.warn('[TopBar] antrenman yenileme basarisiz', error);
      }

      try {
        const activeSession = await getActiveTraining(user.id);
        if (!cancelled) {
          setIsTrainingFacilityAvailable(!activeSession);
        }
      } catch (error) {
        console.warn('[TopBar] antrenman sahasi durumu yuklenemedi', error);
        if (!cancelled) {
          setIsTrainingFacilityAvailable(false);
        }
      }

      try {
        const unseenCount = await getUnviewedTrainingCount(user.id);
        if (!cancelled) {
          setHasUnseenTrainingResults(unseenCount > 0);
        }
      } catch (error) {
        console.warn('[TopBar] antrenman bildirimi yuklenemedi', error);
        if (!cancelled) {
          setHasUnseenTrainingResults(false);
        }
      }

      try {
        const youthList = await getYouthCandidates(user.id);
        if (!cancelled) {
          setHasYouthCandidates(youthList.length > 0);
        }
      } catch (error) {
        console.warn('[TopBar] altyapi bildirimi yuklenemedi', error);
        if (!cancelled) {
          setHasYouthCandidates(false);
        }
      }

      try {
        const ready = await getYouthGenerationAvailability(user.id);
        if (!cancelled) {
          setCanGenerateYouthCandidate(ready);
        }
      } catch (error) {
        console.warn('[TopBar] altyapi uretim durumu yuklenemedi', error);
        if (!cancelled) {
          setCanGenerateYouthCandidate(false);
        }
      }
    };

    loadNotifications();

    try {
      unsubscribeYouth = listenYouthCandidates(user.id, (list) => {
        if (!cancelled) {
          setHasYouthCandidates(list.length > 0);
        }
      });
    } catch (error) {
      console.warn('[TopBar] altyapi bildirim dinleyicisi basarisiz', error);
      if (!cancelled) {
        setHasYouthCandidates(false);
      }
    }

    try {
      unsubscribeTraining = listenActiveTraining(user.id, (session) => {
        if (!cancelled) {
          setIsTrainingFacilityAvailable(!session);
        }
      });
    } catch (error) {
      console.warn('[TopBar] antrenman dinleyicisi basarisiz', error);
      if (!cancelled) {
        setIsTrainingFacilityAvailable(false);
      }
    }

    try {
      unsubscribeYouthGeneration = listenYouthGenerationAvailability(user.id, (ready) => {
        if (!cancelled) {
          setCanGenerateYouthCandidate(ready);
        }
      });
    } catch (error) {
      console.warn('[TopBar] altyapi uretim dinleyicisi basarisiz', error);
      if (!cancelled) {
        setCanGenerateYouthCandidate(false);
      }
    }

    return () => {
      cancelled = true;
      unsubscribeYouth?.();
      unsubscribeTraining?.();
      unsubscribeYouthGeneration?.();
    };
  }, [user]);

  const notifications = useMemo(() => {
    const items: {
      id: string;
      message: string;
      icon: LucideIcon;
      path: string;
    }[] = [];

    if (isTrainingFacilityAvailable && !hasUnseenTrainingResults) {
      items.push({
        id: 'training-ready',
        message: 'Antrenman sahasi musait. Yeni calisma baslatabilirsin.',
        icon: Dumbbell,
        path: '/training',
      });
    }

    if (hasUnseenTrainingResults) {
      items.push({
        id: 'training',
        message: 'Gormediginiz antrenman sonuclari hazir.',
        icon: Dumbbell,
        path: '/training',
      });
    }

    if (hasYouthCandidates) {
      items.push({
        id: 'youth',
        message: 'Altyapidan takima katilabilecek oyuncular var.',
        icon: UserPlus,
        path: '/youth',
      });
    } else if (canGenerateYouthCandidate) {
      items.push({
        id: 'youth-generate',
        message: 'Altyapi merkezinde yeni oyuncu uretimi icin hazirsin.',
        icon: UserPlus,
        path: '/youth',
      });
    }

    return items;
  }, [canGenerateYouthCandidate, hasUnseenTrainingResults, hasYouthCandidates, isTrainingFacilityAvailable]);

  const handleNotificationClick = useCallback(
    (path: string) => {
      setIsNotificationOpen(false);
      navigate(path);
    },
    [navigate],
  );

  const handlePurchase = async (type: KitType, method: 'ad' | 'diamonds') => {
    try {
      await purchaseKit(type, method);
    } catch (error) {
      // errors are surfaced through toasts inside the provider
      console.warn('[TopBar] purchase kit failed', error);
    }
  };

  const handleUse = (type: KitType) => {
    if ((kits[type] ?? 0) <= 0) {
      toast.error('Stokta yeterli kit bulunmuyor.');
      return;
    }
    setActiveKit(type);
    setIsUsageOpen(true);
  };

  const handleUsageOpenChange = (open: boolean) => {
    setIsUsageOpen(open);
    if (!open) {
      setActiveKit(null);
    }
  };

  return (
    <>
      <header
        ref={topBarRef}
        className={`nostalgia-topbar px-3 py-3 sm:px-4${isVisible ? ' nostalgia-topbar--visible' : ''}`}
        aria-hidden={!isVisible}
        data-topbar-state={isVisible ? 'visible' : 'hidden'}
        role="banner"
      >
        <div className="nostalgia-topbar__inner">
          <div className="nostalgia-topbar__identity">
            {user ? (
              <div
                className="nostalgia-topbar__identity-info"
                data-topbar-focus-target
                tabIndex={-1}
              >
                <div className="nostalgia-topbar__team">
                  <div className="nostalgia-topbar__team-avatar">
                    {user.teamLogo && /^(data:image|https?:\/\/)/.test(user.teamLogo) ? (
                      <img
                        src={user.teamLogo}
                        alt="Takım logosu"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-2xl leading-none">{user.teamLogo ?? '⚽'}</span>
                    )}
                  </div>
                  <span className="nostalgia-topbar__team-name" title={displayTeamName}>
                    {displayTeamName}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="nostalgia-topbar__kits" aria-label="Takim kitleri">
            <div className="nostalgia-topbar__kits-viewport" aria-live="polite">
              {kitTypes.map((type, index) => {
                const isActiveKit = type === currentKitType;
                const { icon: Icon, color } = KIT_ICONS[type];
                const count = kits[type] ?? 0;
                const config = KIT_CONFIG[type];
                const effectText = formatKitEffect(type);

                return (
                  <div
                    key={type}
                    className={`nostalgia-topbar__kit${isActiveKit ? ' nostalgia-topbar__kit--active' : ''}`}
                    aria-hidden={!isActiveKit}
                  >
                    <DropdownMenu
                      open={isActiveKit ? isKitMenuOpen : false}
                      onOpenChange={(open) => {
                        if (open) {
                          setCurrentKitIndex(index);
                        }
                        setIsKitMenuOpen(open);
                      }}
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex items-center gap-2 whitespace-nowrap text-slate-200 hover:bg-white/10 hover:text-white"
                        >
                          <Icon className={`h-4 w-4 ${color}`} />
                          <span className="text-sm font-medium">{config.label}</span>
                          <Badge
                            variant={count > 0 ? 'secondary' : 'outline'}
                            className="border border-white/20 bg-white/10 px-1.5 py-0 text-[11px] text-slate-100"
                          >
                            {count}
                          </Badge>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-64">
                        <DropdownMenuLabel>{config.label}</DropdownMenuLabel>
                        <p className="px-2 text-xs text-muted-foreground">{config.description}</p>
                        {effectText && (
                          <p className="px-2 pb-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            {effectText}
                          </p>
                        )}
                        <DropdownMenuItem disabled={isProcessing} onClick={() => handlePurchase(type, 'ad')}>
                          Reklam izle (+{config.adReward})
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={isProcessing} onClick={() => handlePurchase(type, 'diamonds')}>
                          {config.diamondCost} Elmas ile Satin Al
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={count === 0 || isProcessing} onClick={() => handleUse(type)}>
                          {count === 0 ? 'Stok Yok' : 'Kiti Kullan'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="nostalgia-topbar__controls">
            <div className="nostalgia-topbar__team-meta" aria-label="Takim ozeti">
              <Badge
                variant="secondary"
                className="border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-slate-100 shadow-sm backdrop-blur-sm sm:text-xs"
              >
                Overall: {teamOverall ?? '-'}
              </Badge>
              <Badge
                variant="outline"
                className="border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-slate-100 sm:text-xs"
              >
                Form: {teamForm ?? '-'}
              </Badge>
            </div>
            <div className="nostalgia-topbar__control-buttons">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleTheme}
                className="text-slate-200 hover:bg-white/10 hover:text-white"
              >
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/store/vip')}
                className={vipButtonClass}
                title={vipTooltip}
              >
                <div className="relative flex items-center gap-1">
                  <Crown className={`h-4 w-4 ${vipIconClass}`} />
                  {vipActive ? (
                    <span className="text-xs font-semibold text-amber-200">VIP</span>
                  ) : (
                    <span className="text-xs font-semibold text-slate-300">VIP</span>
                  )}
                  {vipActive && (
                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400 shadow" />
                  )}
                </div>
                <span className="sr-only">VIP magazasi</span>
              </Button>
              <Popover open={isNotificationOpen} onOpenChange={setIsNotificationOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-slate-200 hover:bg-white/10 hover:text-white">
                    <div className="relative">
                      <Bell className="h-4 w-4" />
                      {notifications.length > 0 && (
                        <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                      )}
                    </div>
                  </Button>
                </PopoverTrigger>
                <PopoverContent ref={notificationContentRef} align="end" className="w-64 p-2">
                  {notifications.length > 0 ? (
                    <ul className="space-y-1.5">
                      {notifications.map(({ id, message, icon: Icon, path }) => (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => handleNotificationClick(path)}
                            className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground transition hover:bg-muted/80 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <Icon className="mt-0.5 h-4 w-4 text-primary" />
                            <span>{message}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">Yeni bildiriminiz bulunmuyor.</p>
                  )}
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="text-slate-200 hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>

            {isProcessing && <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
            <button
              type="button"
              onClick={() => navigate('/store/diamonds')}
              className="nostalgia-topbar__balance group rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-slate-100 transition hover:border-sky-300/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60"
              data-testid="topbar-diamond-balance"
            >
              <Diamond className="h-5 w-5 text-sky-300 drop-shadow" />
              <span className="font-semibold text-slate-100">{balance}</span>
              <span className="text-[11px] text-sky-100/80 transition group-hover:text-sky-50">Elmas</span>
            </button>
          </div>
        </div>
      </header>
      <KitUsageDialog open={isUsageOpen} kitType={activeKit} onOpenChange={handleUsageOpenChange} />
    </>
  );
});

TopBar.displayName = 'TopBar';

export default TopBar;



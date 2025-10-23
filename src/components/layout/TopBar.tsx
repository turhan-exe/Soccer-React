import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BatteryCharging,
  Crown,
  Diamond,
  Dumbbell,
  HeartPulse,
  Loader2,
  Plus,
  Smile,
  UserPlus,
  Moon,
  Sun,
  LogOut,
  Bell,
  type LucideIcon,
} from 'lucide-react';

import AppLogo from '@/components/AppLogo';
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
import { finalizeExpiredTrainingSession, getUnviewedTrainingCount } from '@/services/training';
import { getYouthCandidates } from '@/services/youth';
import type { KitType } from '@/types';
import { KIT_CONFIG, formatKitEffect } from '@/lib/kits';
import KitUsageDialog from '@/components/kit/KitUsageDialog';
import { toast } from 'sonner';
import { normalizeRatingTo100 } from '@/lib/player';
import '@/styles/nostalgia-theme.css';

const KIT_ICONS: Record<KitType, { icon: LucideIcon; color: string }> = {
  energy: { icon: BatteryCharging, color: 'text-emerald-500' },
  morale: { icon: Smile, color: 'text-amber-500' },
  health: { icon: HeartPulse, color: 'text-rose-500' },
};

const TopBar = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { balance } = useDiamonds();
  const { kits, purchaseKit, isProcessing, vipActive, vipStatus } = useInventory();
  const [activeKit, setActiveKit] = useState<KitType | null>(null);
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const [teamOverall, setTeamOverall] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState<string | null>(null);
  const [hasUnseenTrainingResults, setHasUnseenTrainingResults] = useState(false);
  const [hasYouthCandidates, setHasYouthCandidates] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const swipePointerIdRef = useRef<number | null>(null);
  const swipeStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const vipIconClass = vipActive ? 'text-amber-300 drop-shadow' : 'text-slate-400';
  const vipButtonClass = vipActive
    ? 'bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100'
    : 'text-slate-300 hover:text-white hover:bg-white/10';
  const vipPlanName = vipStatus.plan ? vipStatus.plan.toUpperCase() : null;
  const vipTooltip = vipActive
    ? `VIP aktif${vipPlanName ? ` (${vipPlanName})` : ''}`
    : 'VIP paketlerini kesfet';

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
          const starters = team.players.filter((player) => player.squadRole === 'starting');
          if (starters.length) {
            const average = starters.reduce((sum, player) => sum + player.overall, 0) / starters.length;
            setTeamOverall(normalizeRatingTo100(average));
          } else {
            setTeamOverall(null);
          }
        } else {
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
    if (!user) {
      setHasUnseenTrainingResults(false);
      setHasYouthCandidates(false);
      return;
    }

    let cancelled = false;

    const loadNotifications = async () => {
      try {
        await finalizeExpiredTrainingSession(user.id);
      } catch (error) {
        console.warn('[TopBar] antrenman yenileme basarisiz', error);
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
    };

    loadNotifications();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const scrollContainer = document.querySelector<HTMLElement>('[data-app-scroll-container]');
    const target: HTMLElement | Window = scrollContainer ?? window;

    const handleScroll = () => {
      const current =
        target instanceof Window
          ? window.scrollY || document.documentElement.scrollTop
          : target.scrollTop;

      if (current > lastScrollTopRef.current && current > 12) {
        setIsVisible(true);
      } else if (current <= 4) {
        setIsVisible(false);
      }

      lastScrollTopRef.current = Math.max(current, 0);
    };

    target.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      target.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) {
        swipePointerIdRef.current = null;
        swipeStartPointRef.current = null;
        return;
      }

      const topBarElement = topBarRef.current;
      if (topBarElement && topBarElement.contains(event.target as Node)) {
        swipePointerIdRef.current = null;
        swipeStartPointRef.current = null;
        return;
      }

      swipePointerIdRef.current = event.pointerId;
      swipeStartPointRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (swipePointerIdRef.current !== event.pointerId || !swipeStartPointRef.current) {
        return;
      }

      const deltaX = event.clientX - swipeStartPointRef.current.x;
      const deltaY = event.clientY - swipeStartPointRef.current.y;

      if (Math.abs(deltaY) <= 48 || Math.abs(deltaY) <= Math.abs(deltaX) * 1.2) {
        return;
      }

      if (deltaY > 0) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }

      swipePointerIdRef.current = null;
      swipeStartPointRef.current = null;
    };

    const resetSwipe = (event: PointerEvent) => {
      if (swipePointerIdRef.current === event.pointerId) {
        swipePointerIdRef.current = null;
        swipeStartPointRef.current = null;
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerup', resetSwipe, { passive: true });
    document.addEventListener('pointercancel', resetSwipe, { passive: true });

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', resetSwipe);
      document.removeEventListener('pointercancel', resetSwipe);
    };
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const element = topBarRef.current;
      if (element && !element.contains(event.target as Node)) {
        setIsVisible(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isVisible]);

  const notifications = useMemo(() => {
    const items: {
      id: string;
      message: string;
      icon: LucideIcon;
    }[] = [];

    if (hasUnseenTrainingResults) {
      items.push({
        id: 'training',
        message: 'Gormediginiz antrenman sonuclari hazir.',
        icon: Dumbbell,
      });
    }

    if (hasYouthCandidates) {
      items.push({
        id: 'youth',
        message: 'Altyapidan takima katilabilecek oyuncular var.',
        icon: UserPlus,
      });
    }

    return items;
  }, [hasUnseenTrainingResults, hasYouthCandidates]);

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
      >
        <div className="nostalgia-topbar__inner">
          <div className="nostalgia-topbar__identity">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="nostalgia-topbar__home-button flex shrink-0 items-center rounded-xl border border-white/10 bg-white/5 p-1 transition hover:border-cyan-300/40 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
              aria-label="Ana menuye don"
            >
              <AppLogo size="sm" showText textClassName="hidden xl:inline" />
            </button>

            {user ? (
              <div className="nostalgia-topbar__identity-info">
                <div className="nostalgia-topbar__team">
                  <div className="nostalgia-topbar__team-avatar">
                    {user.teamLogo && /^(data:image|https?:\/\/)/.test(user.teamLogo) ? (
                      <img
                        src={user.teamLogo}
                        alt="Takım logosu"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl leading-none">{user.teamLogo ?? '⚽'}</span>
                    )}
                  </div>
                  <span className="nostalgia-topbar__team-name" title={user.teamName}>
                    {user.teamName}
                  </span>
                </div>
                <div className="nostalgia-topbar__team-meta">
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
              </div>
            ) : null}
          </div>

          <div className="nostalgia-topbar__kits" aria-label="Takim kitleri">
            {(Object.keys(KIT_ICONS) as KitType[]).map((type) => {
              const { icon: Icon, color } = KIT_ICONS[type];
              const count = kits[type] ?? 0;
              const config = KIT_CONFIG[type];
              const effectText = formatKitEffect(type);

              return (
                <DropdownMenu key={type}>
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
              );
            })}
          </div>

          <div className="nostalgia-topbar__controls">
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
              <Popover>
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
                <PopoverContent align="end" className="w-64 p-2">
                  {notifications.length > 0 ? (
                    <ul className="space-y-2">
                      {notifications.map(({ id, message, icon: Icon }) => (
                        <li key={id} className="flex items-start gap-2 text-sm">
                          <Icon className="mt-0.5 h-4 w-4 text-primary" />
                          <span className="text-muted-foreground">{message}</span>
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
            <div className="nostalgia-topbar__balance" data-testid="topbar-diamond-balance">
              <Diamond className="h-5 w-5 text-sky-300 drop-shadow" />
              <span className="text-slate-100">{balance}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/store/diamonds')}
              data-testid="topbar-diamond-plus"
              className="text-slate-200 hover:bg-white/10 hover:text-white"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <KitUsageDialog open={isUsageOpen} kitType={activeKit} onOpenChange={handleUsageOpenChange} />
    </>
  );
};

export default TopBar;



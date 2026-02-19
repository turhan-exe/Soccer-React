import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent } from 'react';
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
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Star,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { subscribeToUnreadChats, getChatId } from '@/services/privateChat';
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
    const { kits, purchaseKit, isProcessing, vipActive, vipStatus, vipNostalgiaFreeAvailable } = useInventory();
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
    const [unreadChats, setUnreadChats] = useState<any[]>([]);

    // Track dismissed notification IDs
    const [dismissedIds, setDismissedIds] = useState<string[]>([]);

    const topBarRef = useRef<HTMLDivElement | null>(null);
    const notificationContentRef = useRef<HTMLDivElement | null>(null);
    const lastVisibilityChangeRef = useRef<number>(0);
    const focusFrameRef = useRef<number | null>(null);

    // Track previously sent notifications to avoid spamming
    const sentNotificationIdsRef = useRef<Set<string>>(new Set());

    const vipIconClass = vipActive ? 'text-amber-300 drop-shadow' : 'text-slate-400';
    const vipButtonClass = vipActive
      ? 'bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100'
      : 'text-slate-300 hover:text-white hover:bg-white/10';
    const vipPlanName = vipStatus.plan ? vipStatus.plan.toUpperCase() : null;
    const vipTooltip = vipActive
      ? `VIP aktif${vipPlanName ? ` (${vipPlanName})` : ''}`
      : 'VIP paketlerini kesfet';
    const kitCount = kitTypes.length;
    const currentKitType = kitCount > 0 ? kitTypes[currentKitIndex % kitCount] : null;

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
      if (kitCount === 0) {
        setCurrentKitIndex(0);
        setIsKitMenuOpen(false);
        return;
      }
      if (currentKitIndex >= kitCount) {
        setCurrentKitIndex(0);
      }
    }, [kitCount, currentKitIndex]);

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
      let unsubscribeChats: (() => void) | null = null;

      // ... (existing loadNotifications logic) ...
      const loadNotifications = async () => {
        // ... (existing try-catch blocks) ...
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

      // Chat Notifications
      try {
        unsubscribeChats = subscribeToUnreadChats(user.id, (chats) => {
          if (!cancelled) {
            setUnreadChats(chats);
          }
        });
      } catch (error) {
        console.warn('[TopBar] sohbet bildirim dinleyicisi basarisiz', error);
      }

      return () => {
        cancelled = true;
        unsubscribeYouth?.();
        unsubscribeTraining?.();
        unsubscribeYouthGeneration?.();
        unsubscribeChats?.();
      };
    }, [user]);

    const notifications = useMemo(() => {
      const items: {
        id: string;
        message: string;
        icon: LucideIcon;
        path: string;
        accent: string;
      }[] = [];

      if (isTrainingFacilityAvailable && !hasUnseenTrainingResults) {
        items.push({
          id: 'training-ready',
          message: 'Antrenman sahasi musait. Yeni calisma baslatabilirsin.',
          icon: Dumbbell,
          path: '/training',
          accent: 'text-orange-400',
        });
      }

      if (hasUnseenTrainingResults) {
        items.push({
          id: 'training',
          message: 'Gormediginiz antrenman sonuclari hazir.',
          icon: Dumbbell,
          path: '/training',
          accent: 'text-orange-400',
        });
      }

      if (hasYouthCandidates) {
        items.push({
          id: 'youth',
          message: 'Altyapidan takima katilabilecek oyuncular var.',
          icon: UserPlus,
          path: '/youth',
          accent: 'text-emerald-400',
        });
      } else if (canGenerateYouthCandidate) {
        items.push({
          id: 'youth-generate',
          message: 'Altyapi merkezinde yeni oyuncu uretimi icin hazirsin.',
          icon: UserPlus,
          path: '/youth',
          accent: 'text-emerald-400',
        });
      }

      if (vipNostalgiaFreeAvailable) {
        items.push({
          id: 'nostalgia-pack',
          message: 'Ücretsiz Nostalji Paketin hazır! Efsane oyuncunu keşfet.',
          icon: Star,
          path: '/store/legends',
          accent: 'text-pink-400',
        });
      }

      // Add Chat Notifications
      unreadChats.forEach(chat => {
        const otherUserId = chat.participants.find((id: string) => id !== user?.id);
        const count = chat.unreadCounts?.[user?.id!] || 0;

        if (count > 0) {
          items.push({
            id: `chat-${chat.id}`,
            message: `${count} yeni mesajin var`,
            icon: MessageCircle,
            path: `/friends?chatWith=${otherUserId}`, // URL parametresi ile yönlendir
            accent: 'text-blue-400'
          });
        }
      });

      // Filter out dismissed notifications
      return items.filter(item => !dismissedIds.includes(item.id));
    }, [
      canGenerateYouthCandidate,
      hasUnseenTrainingResults,
      hasYouthCandidates,
      isTrainingFacilityAvailable,
      vipNostalgiaFreeAvailable,
      dismissedIds
    ]);

    // Request notification permission and handle sending mechanism
    useEffect(() => {
      if (!('Notification' in window)) return;

      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }, []);

    // Send system notifications for new items
    useEffect(() => {
      notifications.forEach(item => {
        if (!sentNotificationIdsRef.current.has(item.id)) {
          sentNotificationIdsRef.current.add(item.id);

          // Try to send push/system notification
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              const n = new Notification('Football Manager', {
                body: item.message,
                icon: '/android-chrome-192x192.png', // Assuming pwa icon exists
                tag: item.id
              });
              n.onclick = () => {
                window.focus();
                navigate(item.path);
                n.close();
              };
            } catch (e) {
              console.warn('System notification failed', e);
            }
          }
        }
      });
    }, [notifications, navigate]);

    const handleNavigateHome = useCallback(() => {
      navigate('/');
    }, [navigate]);

    // New handler: Navigate AND Dismiss
    const handleNotificationClick = useCallback(
      (id: string, path: string) => {
        // Add to dismissed list
        setDismissedIds(prev => [...prev, id]);
        setIsNotificationOpen(false);
        navigate(path);
      },
      [navigate],
    );

    const handleIdentityKeyDown = useCallback(
      (event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleNavigateHome();
        }
      },
      [handleNavigateHome],
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
          className={`nostalgia-topbar px-4 py-2${isVisible ? ' nostalgia-topbar--visible' : ''}`}
          aria-hidden={!isVisible}
          data-topbar-state={isVisible ? 'visible' : 'hidden'}
          role="banner"
        >
          <div className="nostalgia-topbar__inner" data-topbar-focus-target tabIndex={-1}>
            <div className="nostalgia-topbar__identity">
              <span
                className="nostalgia-topbar__identity-name"
                title={displayTeamName}
                role="button"
                tabIndex={0}
                onClick={handleNavigateHome}
                onKeyDown={handleIdentityKeyDown}
              >
                {displayTeamName}
              </span>
              <div className="nostalgia-topbar__identity-meta" aria-label="Takim ozeti">
                <Badge variant="secondary" className="nostalgia-topbar__pill">
                  Overall: {teamOverall ?? '-'}
                </Badge>
                <Badge variant="outline" className="nostalgia-topbar__pill nostalgia-topbar__pill--muted">
                  Form: {teamForm ?? '-'}
                </Badge>
              </div>
            </div>

            <div className="nostalgia-topbar__kit-switcher" aria-label="Takim kitleri" aria-live="polite">
              <Button
                variant="ghost"
                size="sm"
                className="nostalgia-topbar__kit-arrow"
                onClick={() => {
                  setIsKitMenuOpen(false);
                  setCurrentKitIndex((prev) => (prev - 1 + Math.max(kitCount, 1)) % Math.max(kitCount, 1));
                }}
                disabled={kitCount === 0}
                aria-label="Onceki kit"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {currentKitType ? (
                <DropdownMenu open={isKitMenuOpen} onOpenChange={(open) => setIsKitMenuOpen(open)}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="nostalgia-topbar__kit-chip"
                      aria-haspopup="menu"
                      aria-expanded={isKitMenuOpen}
                    >
                      {(() => {
                        const { icon: Icon, color } = KIT_ICONS[currentKitType];
                        const count = kits[currentKitType] ?? 0;
                        const config = KIT_CONFIG[currentKitType];
                        return (
                          <>
                            <Icon className={`h-4 w-4 ${color}`} />
                            <span className="text-sm font-semibold">{config.label}</span>
                            <span className="nostalgia-topbar__kit-count">{count}</span>
                          </>
                        );
                      })()}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-64">
                    {(() => {
                      const count = kits[currentKitType] ?? 0;
                      const config = KIT_CONFIG[currentKitType];
                      const effectText = formatKitEffect(currentKitType);
                      return (
                        <>
                          <DropdownMenuLabel>{config.label}</DropdownMenuLabel>
                          <p className="px-2 text-xs text-muted-foreground">{config.description}</p>
                          {effectText && (
                            <p className="px-2 pb-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              {effectText}
                            </p>
                          )}
                          <DropdownMenuItem disabled={isProcessing} onClick={() => handlePurchase(currentKitType, 'ad')}>
                            Reklam izle (+{config.adReward})
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={isProcessing} onClick={() => handlePurchase(currentKitType, 'diamonds')}>
                            {config.diamondCost} Elmas ile Satin Al
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={count === 0 || isProcessing} onClick={() => handleUse(currentKitType)}>
                            {count === 0 ? 'Stok Yok' : 'Kiti Kullan'}
                          </DropdownMenuItem>
                        </>
                      );
                    })()}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="nostalgia-topbar__kit-empty">Kit bulunmuyor</div>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="nostalgia-topbar__kit-arrow"
                onClick={() => {
                  setIsKitMenuOpen(false);
                  setCurrentKitIndex((prev) => (prev + 1) % Math.max(kitCount, 1));
                }}
                disabled={kitCount === 0}
                aria-label="Sonraki kit"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="nostalgia-topbar__actions">
              <div className="nostalgia-topbar__action-buttons">
                <Button variant="ghost" size="sm" onClick={toggleTheme} className="nostalgia-topbar__icon-button">
                  {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/store/vip')}
                  className={`nostalgia-topbar__vip-button ${vipButtonClass}`}
                  title={vipTooltip}
                >
                  <div className="relative flex items-center gap-1">
                    <Crown className={`h-4 w-4 ${vipIconClass}`} />
                    <span className="text-xs font-semibold">VIP</span>
                    {vipActive && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400 shadow" />}
                  </div>
                  <span className="sr-only">VIP magazasi</span>
                </Button>
                <Popover open={isNotificationOpen} onOpenChange={setIsNotificationOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="nostalgia-topbar__icon-button relative">
                      <Bell className="h-4 w-4" />
                      {notifications.length > 0 && (
                        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    ref={notificationContentRef}
                    align="end"
                    className="w-80 p-0 border border-white/10 bg-slate-950/90 backdrop-blur-xl shadow-2xl rounded-xl overflow-hidden"
                  >
                    <div className="px-4 py-3 border-b border-white/5 bg-white/5">
                      <h4 className="text-sm font-semibold text-slate-200">Bildirimler</h4>
                    </div>
                    {notifications.length > 0 ? (
                      <div className="max-h-[300px] overflow-y-auto p-1">
                        <ul className="space-y-1">
                          {notifications.map(({ id, message, icon: Icon, path, accent }) => (
                            <li key={id}>
                              <button
                                type="button"
                                onClick={() => handleNotificationClick(id, path)}
                                className="group flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-all hover:bg-white/5 active:scale-[0.98]"
                              >
                                <div className={`mt-0.5 rounded-full p-1.5 bg-slate-900/50 group-hover:bg-slate-800 ${accent}`}>
                                  <Icon className="h-4 w-4" />
                                </div>
                                <div className="flex-1 space-y-1">
                                  <p className="text-xs font-medium leading-normal text-slate-300 group-hover:text-white">
                                    {message}
                                  </p>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="py-8 text-center px-4">
                        <Bell className="mx-auto h-8 w-8 text-slate-700/50 mb-2" />
                        <p className="text-xs text-slate-500 font-medium">Yeni bildiriminiz bulunmuyor.</p>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
                <Button variant="ghost" size="sm" onClick={logout} className="nostalgia-topbar__icon-button">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>

              <div className="nostalgia-topbar__balance-wrapper">
                {isProcessing && <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
                <button
                  type="button"
                  onClick={() => navigate('/store/diamonds')}
                  className="nostalgia-topbar__balance"
                  data-testid="topbar-diamond-balance"
                >
                  <Diamond className="h-5 w-5 text-sky-300 drop-shadow" />
                  <span className="font-semibold text-slate-100">{balance}</span>
                  <span className="text-[11px] text-sky-100/80">Elmas</span>
                </button>
              </div>
            </div>
          </div>
        </header>
        <KitUsageDialog open={isUsageOpen} kitType={activeKit} onOpenChange={handleUsageOpenChange} />
      </>
    );
  });

TopBar.displayName = 'TopBar';

export default TopBar;

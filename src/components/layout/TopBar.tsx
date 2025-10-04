import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BatteryCharging,
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
  const { kits, purchaseKit, isProcessing } = useInventory();
  const [activeKit, setActiveKit] = useState<KitType | null>(null);
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const [teamOverall, setTeamOverall] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState<string | null>(null);
  const [hasUnseenTrainingResults, setHasUnseenTrainingResults] = useState(false);
  const [hasYouthCandidates, setHasYouthCandidates] = useState(false);

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
            setTeamOverall(Number(average.toFixed(3)));
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-background/60 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center rounded-md border border-transparent p-1 transition hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="Ana menuye don"
        >
          <AppLogo size="sm" showText textClassName="hidden xl:inline" />
        </button>

        {user ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="text-2xl leading-none">{user.teamLogo}</span>
            <span className="text-base font-semibold text-foreground">{user.teamName}</span>
            <Badge variant="secondary">Overall: {teamOverall ?? '-'}</Badge>
            <Badge variant="outline">Form: {teamForm ?? '-'}</Badge>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(KIT_ICONS) as KitType[]).map((type) => {
            const { icon: Icon, color } = KIT_ICONS[type];
            const count = kits[type] ?? 0;
            const config = KIT_CONFIG[type];
            const effectText = formatKitEffect(type);

            return (
              <DropdownMenu key={type}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${color}`} />
                    <span className="text-sm font-medium">{config.label}</span>
                    <Badge variant={count > 0 ? 'secondary' : 'outline'}>{count}</Badge>
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
                  <DropdownMenuItem
                    disabled={count === 0 || isProcessing}
                    onClick={() => handleUse(type)}
                  >
                    {count === 0 ? 'Stok Yok' : 'Kiti Kullan'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={toggleTheme}>
          {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm">
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
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut className="h-4 w-4" />
        </Button>

        {isProcessing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <div className="flex items-center gap-1" data-testid="topbar-diamond-balance">
          <Diamond className="h-5 w-5 text-blue-500" />
          <span>{balance}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/store/diamonds')}
          data-testid="topbar-diamond-plus"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <KitUsageDialog open={isUsageOpen} kitType={activeKit} onOpenChange={handleUsageOpenChange} />
    </div>
  );
};

export default TopBar;


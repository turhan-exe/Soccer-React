
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useInventory } from '@/contexts/InventoryContext';
import {
  getMyLeagueId,
  getFixturesForTeam,
  getLeagueTeams,
  listLeagueStandings
} from '@/services/leagues';
import { getTeam } from '@/services/team';
import {
  getUnviewedTrainingCount,
  getActiveTraining
} from '@/services/training';
import {
  getYouthCandidates,
  getYouthGenerationAvailability
} from '@/services/youth';
import { upcomingMatches } from '@/lib/data';
import type { Fixture, KitType } from '@/types';
import { normalizeRatingTo100, normalizeRatingTo100OrNull } from '@/lib/player';
import { KIT_CONFIG, formatKitEffect } from '@/lib/kits';

import {
  Plus,
  Bell,
  LogOut,
  Sun,
  Moon,
  Crown,
  BatteryCharging,
  Smile,
  HeartPulse,
  UserPlus,
  Dumbbell,
  Star
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { toast } from 'sonner';

import bgImage from '@/assets/menu/bg.png';
import matchCardBg from '@/assets/menu/match_card.png';
import iconTeam from '@/assets/menu/team.png';
import iconYouth from '@/assets/menu/youth.png';
import iconTransfer from '@/assets/menu/transfer.png';
import iconNostalgia from '@/assets/menu/nostalgia.png';
import iconLeagues from '@/assets/menu/leagues.png';
import iconTraining from '@/assets/menu/training.png';
import iconFinance from '@/assets/menu/finance.png';
import iconSettings from '@/assets/menu/settings.png';
import iconFriends from '@/assets/menu/friends.png';
import iconChampions from '@/assets/menu/icon_champions.png';
import iconMatchPreview from '@/assets/menu/icon_match_preview.png';
import iconFixtures from '@/assets/menu/icon_fixtures.png';

import GlobalChatWidget from '@/features/chat/GlobalChatWidget';
import '@/styles/nostalgia-theme.css';

const KIT_ICONS: Record<KitType, { icon: any; color: string }> = {
  energy: { icon: BatteryCharging, color: 'text-emerald-500' },
  morale: { icon: Smile, color: 'text-amber-500' },
  health: { icon: HeartPulse, color: 'text-rose-500' },
};

// --- Types ---
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

// --- Helpers ---
const computeForm = (fixtures: Fixture[], teamId: string): FormBadge[] => {
  const played = fixtures.filter(fixture => fixture.status === 'played' && fixture.score).sort((a, b) => a.date.getTime() - b.date.getTime());
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

// --- Components ---
const MenuButton = ({
  label,
  icon,
  onClick,
  className = '',
  bgClass = '',
  layout = 'vertical',
  hideLabel = false
}: {
  label: string;
  icon: string;
  onClick: () => void;
  className?: string;
  bgClass?: string;
  layout?: 'vertical' | 'horizontal';
  hideLabel?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`
      group relative overflow-hidden rounded-2xl border
      shadow-lg transition-all duration-200 active:scale-95
      hover:shadow-xl hover:-translate-y-1
      flex
      ${layout === 'horizontal' ? 'flex-row items-center px-4 gap-3' : 'flex-col items-center justify-center p-3'}
      ${bgClass || 'bg-slate-800/80'} backdrop-blur-md
      ${className}
    `}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none" />
    <div className={`relative z-10 transition-transform duration-300 group-hover:scale-110 drop-shadow-2xl ${layout === 'horizontal' ? 'w-12 h-12' : 'flex-1 w-full max-h-[75%] flex items-center justify-center'}`}>
      <img src={icon} alt={label} className="w-auto h-full max-h-full object-contain filter drop-shadow-md" />
    </div>
    {!hideLabel && (
      <span className={`relative z-10 font-bold text-white tracking-wide uppercase drop-shadow-md group-hover:text-cyan-200 
        ${layout === 'horizontal' ? 'text-lg text-left' : 'mt-auto text-[11px] sm:text-xs text-center leading-tight whitespace-nowrap'}
      `}>
        {label}
      </span>
    )}
  </button>
);

export default function MainMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { balance } = useDiamonds();
  const { kits, purchaseKit, isProcessing, vipActive, vipStatus, vipNostalgiaFreeAvailable } = useInventory();

  const [matchHighlight, setMatchHighlight] = useState<MatchHighlight | null>(null);
  const [currentRank, setCurrentRank] = useState<number | null>(null);

  // Notification & TopBar Logic State
  const [hasUnseenTrainingResults, setHasUnseenTrainingResults] = useState(false);
  const [isTrainingFacilityAvailable, setIsTrainingFacilityAvailable] = useState(false);
  const [hasYouthCandidates, setHasYouthCandidates] = useState(false);
  const [canGenerateYouthCandidate, setCanGenerateYouthCandidate] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  // Kit Logic State
  const [currentKitIndex, setCurrentKitIndex] = useState(0);
  const kitTypes = useMemo(() => Object.keys(KIT_ICONS) as KitType[], []);
  const kitCount = kitTypes.length;
  const currentKitType = kitCount > 0 ? kitTypes[currentKitIndex % kitCount] : null;
  const [isKitMenuOpen, setIsKitMenuOpen] = useState(false);

  // Auto-cycle kits every 5 seconds
  useEffect(() => {
    if (isKitMenuOpen) return; // Don't cycle if menu is open

    const interval = setInterval(() => {
      setCurrentKitIndex(prev => (prev + 1) % kitCount);
    }, 5000);

    return () => clearInterval(interval);
  }, [kitCount, isKitMenuOpen]);

  const isDark = theme === 'dark';

  // --- Kit Handlers ---
  const handlePurchase = async (type: KitType, method: 'ad' | 'diamonds') => {
    try {
      await purchaseKit(type, method);
    } catch (error) {
      console.warn('[MainMenu] purchase kit failed', error);
    }
  };

  const handleUse = (type: KitType) => {
    if ((kits[type] ?? 0) <= 0) {
      toast.error('Stokta yeterli kit bulunmuyor.');
      return;
    }
    // Logic to actually "use" the kit would go here, 
    // but original TopBar only set active state. 
    // For now we just close and maybe toast.
    toast.info(`${KIT_CONFIG[type].label} kullanildi (Demo)`);
    setIsKitMenuOpen(false);
  };

  // --- Rank Fetching ---
  useEffect(() => {
    if (!user) return;
    const fetchRank = async () => {
      try {
        const leagueId = await getMyLeagueId(user.id);
        if (leagueId) {
          const standings = await listLeagueStandings(leagueId);
          const myRank = standings.findIndex(s => s.id === user.id || s.teamId === user.id) + 1;
          if (myRank > 0) setCurrentRank(myRank);
        }
      } catch (e) {
        console.warn("Rank fetch failed", e);
      }
    };
    fetchRank();
  }, [user]);

  // --- Notifications Logic (Ported from TopBar) ---
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadStatus = async () => {
      try {
        // Training
        const activeSession = await getActiveTraining(user.id);
        if (!cancelled) setIsTrainingFacilityAvailable(!activeSession);

        const unseenCount = await getUnviewedTrainingCount(user.id);
        if (!cancelled) setHasUnseenTrainingResults(unseenCount > 0);

        // Youth
        const youthList = await getYouthCandidates(user.id);
        if (!cancelled) setHasYouthCandidates(youthList.length > 0);

        const youthReady = await getYouthGenerationAvailability(user.id);
        if (!cancelled) setCanGenerateYouthCandidate(youthReady);

      } catch (e) { console.warn("Status check failed", e); }
    };
    loadStatus();
    return () => { cancelled = true; };
  }, [user]);

  const notifications = useMemo(() => {
    const items: { id: string; message: string; icon: any; path: string; accent: string }[] = [];

    if (isTrainingFacilityAvailable && !hasUnseenTrainingResults) {
      items.push({ id: 'training-ready', message: 'Antrenman sahasi musait.', icon: Dumbbell, path: '/training', accent: 'text-orange-400' });
    }
    if (hasUnseenTrainingResults) {
      items.push({ id: 'training', message: 'Antrenman sonuclari hazir.', icon: Dumbbell, path: '/training', accent: 'text-orange-400' });
    }
    if (hasYouthCandidates) {
      items.push({ id: 'youth', message: 'Altyapida yeni yetenekler var.', icon: UserPlus, path: '/youth', accent: 'text-emerald-400' });
    } else if (canGenerateYouthCandidate) {
      items.push({ id: 'youth-generate', message: 'Altyapi raporu isteyebilirsin.', icon: UserPlus, path: '/youth', accent: 'text-emerald-400' });
    }
    if (vipNostalgiaFreeAvailable) {
      items.push({ id: 'nostalgia', message: 'Ucretsiz Nostalji Paketin hazir!', icon: Star, path: '/legend-pack', accent: 'text-pink-400' });
    }

    return items.filter(i => !dismissedIds.includes(i.id));
  }, [isTrainingFacilityAvailable, hasUnseenTrainingResults, hasYouthCandidates, canGenerateYouthCandidate, vipNostalgiaFreeAvailable, dismissedIds]);

  const handleNotificationClick = (id: string, path: string) => {
    setDismissedIds(prev => [...prev, id]);
    setIsNotificationOpen(false);
    navigate(path);
  };

  // --- Existing Logic (Quick Stats / Match Highlight) ---
  useEffect(() => {
    const loadQuickStats = async () => {
      if (!user) {
        // Fallback for no user
        const fallbackMatch = upcomingMatches[0];
        if (fallbackMatch) {
          const fallbackDate = new Date(`${fallbackMatch.date}T${fallbackMatch.time ?? '00:00'}`);
          const hasValidDate = !Number.isNaN(fallbackDate.getTime());
          setMatchHighlight({
            competition: fallbackMatch.competition ?? 'Lig Maci',
            dateText: hasValidDate ? fallbackDate.toLocaleDateString('tr-TR') : fallbackMatch.date,
            timeText: fallbackMatch.time || '',
            venue: fallbackMatch.venue ?? 'home',
            venueName: fallbackMatch.venueName,
            team: { name: 'Takimim', form: [] },
            opponent: {
              name: fallbackMatch.opponent,
              logo: fallbackMatch.opponentLogo,
              logoUrl: fallbackMatch.opponentLogoUrl,
              form: [],
              overall: normalizeRatingTo100OrNull(fallbackMatch.opponentStats?.overall),
            }
          });
        }
        return;
      }
      try {
        const leagueId = await getMyLeagueId(user.id);
        let teamName = user.teamName ?? 'Takimim';
        let teamLogo = user.teamLogo ?? null;
        let teamForm: FormBadge[] = [];
        let teamOverall: number | null = null;
        if (leagueId) {
          const [fixtures, leagueTeams, myTeam] = await Promise.all([
            getFixturesForTeam(leagueId, user.id),
            getLeagueTeams(leagueId).catch(() => []),
            getTeam(user.id).catch(() => null),
          ]);
          teamName = myTeam?.name ?? teamName;
          teamLogo = myTeam?.logo ?? teamLogo;
          teamOverall = calculateTeamOverall(myTeam?.players ?? null);
          teamForm = computeForm(fixtures, user.id);
          const upcoming = fixtures.filter(f => f.status !== 'played').sort((a, b) => a.date.getTime() - b.date.getTime());
          const next = upcoming[0];
          if (next) {
            const isHome = next.homeTeamId === user.id;
            const opponentId = isHome ? next.awayTeamId : next.homeTeamId;
            const teamMap = new Map<string, string>(leagueTeams.map((t: { id: string; name: string }) => [t.id, t.name] as [string, string]));
            const opponentName = teamMap.get(opponentId) ?? 'Rakip';
            let opponentLogo = null;
            let opponentForm: FormBadge[] = [];
            let opponentOverall = null;
            try {
              const [oppTeam, oppFix] = await Promise.all([
                getTeam(opponentId).catch(() => null),
                getFixturesForTeam(leagueId, opponentId).catch(() => [])
              ]);
              opponentLogo = oppTeam?.logo;
              opponentForm = computeForm(oppFix, opponentId);
              opponentOverall = calculateTeamOverall(oppTeam?.players ?? null);
            } catch (e) { }
            const fallbackStatic = upcomingMatches.find(m => m.opponent.toLowerCase() === opponentName.toLowerCase());
            if (!opponentLogo && fallbackStatic?.opponentLogo) opponentLogo = fallbackStatic.opponentLogo;
            if (opponentOverall == null && fallbackStatic?.opponentStats?.overall) opponentOverall = normalizeRatingTo100(fallbackStatic.opponentStats.overall);
            setMatchHighlight({
              competition: 'Lig Maci',
              dateText: next.date.toLocaleDateString('tr-TR'),
              timeText: next.date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
              venue: isHome ? 'home' : 'away',
              venueName: undefined,
              team: { name: teamName, logo: teamLogo, form: teamForm, overall: teamOverall },
              opponent: { name: opponentName, logo: opponentLogo, form: opponentForm, overall: opponentOverall }
            });
            return;
          }
        }
        const fallbackMatch = upcomingMatches[0];
        if (fallbackMatch) {
          setMatchHighlight({
            competition: fallbackMatch.competition ?? 'Dostluk Maci',
            dateText: 'Bugun',
            timeText: '21:00',
            venue: 'home',
            team: { name: teamName, logo: teamLogo, form: teamForm, overall: teamOverall },
            opponent: { name: fallbackMatch.opponent, logo: fallbackMatch.opponentLogo, form: [], overall: 85 }
          });
        }
      } catch (e) {
        console.error("Menu stats error", e);
      }
    };
    loadQuickStats();
  }, [user]);

  const renderLogo = (logo?: string | null, alt?: string, size = 'w-16 h-16') => {
    const src = getValidLogo(logo);
    if (src) {
      return <img src={src} alt={alt} className={`object-contain drop-shadow-md ${size}`} />;
    }
    return (
      <div className={`${size} rounded-full bg-slate-700/80 border border-slate-500 flex items-center justify-center text-slate-300 font-bold text-lg shadow-inner`}>
        {logo ? logo.substring(0, 2).toUpperCase() : 'FC'}
      </div>
    );
  };

  const headerTextClass = isDark ? "text-white" : "text-white";
  const headerSubTextClass = isDark ? "text-slate-300" : "text-blue-200";

  return (
    <div className={`fixed inset-0 z-50 w-full h-full font-sans select-none transition-colors duration-500 overflow-hidden ${isDark ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-900'}`}>
      {/* Background */}
      <div className="absolute inset-0 z-0" style={{ backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className={`absolute inset-0 ${isDark ? 'bg-slate-950/80' : 'bg-white/10 backdrop-blur-[2px]'}`} />
      </div>

      {/* Main Container - No Scroll, h-full Layout */}
      <div className="relative z-10 w-full h-full flex flex-col">
        {/* Header - Custom for Main Menu */}
        <header className={`shrink-0 h-20 w-full px-4 sm:px-6 flex items-center justify-between shadow-xl z-50 transition-colors duration-300 ${isDark ? 'bg-gradient-to-b from-[#0f1016] to-[#1a1b26] border-b border-white/5' : 'bg-gradient-to-b from-[#154c79] to-[#0f3a5e] text-white border-b border-white/10'}`}>
          <div className="flex items-center gap-4 h-full py-2">
            <div className={`aspect-square h-14 w-14 rounded-2xl overflow-hidden shadow-lg border-2 ${isDark ? 'border-amber-500/20' : 'border-white/20'}`}>
              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username || 'User'}`} alt="Avatar" className="w-full h-full object-cover bg-slate-900" />
            </div>
            <div className="flex flex-col justify-center">
              <span className="text-xl font-black leading-none tracking-wide uppercase text-white drop-shadow-md">{matchHighlight?.team.name || user?.teamName || 'TAKIM İSMİ'}</span>
              {/* Rank Display */}
              <div className="flex items-center gap-2 mt-1">
                {currentRank ? (
                  <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold tracking-wider">
                    LIG SIRALAMASI: #{currentRank}
                  </Badge>
                ) : (
                  <div className="h-5 w-24 bg-white/5 rounded animate-pulse" />
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Energy / Kit Selector */}
            <div className="hidden sm:flex items-center">
              {currentKitType ? (
                <DropdownMenu open={isKitMenuOpen} onOpenChange={setIsKitMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button className={`flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors ${KIT_ICONS[currentKitType]?.color}`}>
                      {(() => {
                        const { icon: Icon } = KIT_ICONS[currentKitType];
                        const count = kits[currentKitType] ?? 0;
                        const config = KIT_CONFIG[currentKitType];
                        return (
                          <>
                            <Icon className="w-4 h-4" />
                            <span className="text-xs font-bold text-slate-200">{config.label}</span>
                            <Badge variant="secondary" className="bg-white/10 text-white ml-1 px-1.5 h-5 min-w-[20px] justify-center">{count}</Badge>
                          </>
                        );
                      })()}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64 bg-[#1a1b26] border-white/10 text-slate-200">
                    {(() => {
                      // Dropdown content same as TopBar logic
                      const count = kits[currentKitType] ?? 0;
                      const config = KIT_CONFIG[currentKitType];
                      const effectText = formatKitEffect(currentKitType);
                      return (
                        <>
                          <DropdownMenuLabel>{config.label}</DropdownMenuLabel>
                          <p className="px-2 text-xs text-slate-400 mb-2">{config.description}</p>
                          {effectText && <p className="px-2 pb-2 text-xs font-medium text-emerald-400">{effectText}</p>}
                          <div className="grid grid-cols-2 gap-2 p-2">
                            <Button variant="outline" size="sm" className="h-8 text-xs border-white/10 hover:bg-white/5" disabled={isProcessing} onClick={() => handlePurchase(currentKitType, 'ad')}>Reklam İzle</Button>
                            <Button variant="outline" size="sm" className="h-8 text-xs border-white/10 hover:bg-white/5" disabled={isProcessing} onClick={() => handlePurchase(currentKitType, 'diamonds')}>{config.diamondCost} Elmas</Button>
                          </div>
                          <Button variant="default" size="sm" className="w-full mt-2 bg-emerald-600 hover:bg-emerald-500 text-white" disabled={count === 0} onClick={() => handleUse(currentKitType)}>
                            {count === 0 ? 'Stok Yok' : 'Kullan'}
                          </Button>
                        </>
                      );
                    })()}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>

            {/* Currency */}
            <div className="hidden sm:flex items-center gap-2 pl-3 pr-1 py-1 rounded-full border border-white/10 bg-slate-900/50 shadow-inner">
              <div className="w-5 h-5 rotate-45 border-2 border-purple-500 bg-purple-400/20 shadow-[0_0_10px_rgba(168,85,247,0.5)]" />
              <span className="font-black text-sm pr-2 text-white">{balance.toLocaleString()}</span>
              <button onClick={() => navigate('/store/diamonds')} className="w-7 h-7 bg-emerald-500 hover:scale-105 text-white rounded-full flex items-center justify-center shadow-lg transition-transform">
                <Plus size={16} strokeWidth={4} />
              </button>
            </div>

            {/* Actions: VIP, Notifications, Theme, Logout */}
            <div className="flex items-center gap-1 sm:gap-2 border-l border-white/10 pl-3 ml-2">
              {/* VIP Button */}
              <button
                onClick={() => navigate('/store/vip')}
                className={`p-2 rounded-lg transition-all relative group ${vipActive ? 'bg-amber-500/10 text-amber-300' : 'text-slate-400 hover:text-white'}`}
                title={vipActive ? 'VIP Aktif' : 'VIP Ol'}
              >
                <Crown size={22} className={vipActive ? 'drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]' : ''} />
                {vipActive && <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full shadow-lg border border-slate-900" />}
              </button>

              {/* Notifications */}
              <Popover open={isNotificationOpen} onOpenChange={setIsNotificationOpen}>
                <PopoverTrigger asChild>
                  <button className="p-2 text-slate-300 hover:text-white transition-colors relative">
                    <Bell size={22} />
                    {notifications.length > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse border-2 border-slate-900" />}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0 border border-white/10 bg-[#1a1b26]/95 backdrop-blur-xl shadow-2xl rounded-xl">
                  <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex justify-between items-center">
                    <span className="font-bold text-white text-sm">Bildirimler</span>
                    {notifications.length > 0 && <span className="text-[10px] bg-red-500/20 text-red-200 px-2 py-0.5 rounded-full">{notifications.length} Yeni</span>}
                  </div>
                  <div className="max-h-[300px] overflow-y-auto p-1">
                    {notifications.length > 0 ? (
                      <div className="space-y-1">
                        {notifications.map(n => (
                          <button key={n.id} onClick={() => handleNotificationClick(n.id, n.path)} className="w-full text-left p-3 rounded-lg hover:bg-white/5 flex gap-3 group transition-all">
                            <div className={`mt-0.5 p-1.5 rounded-full bg-slate-900/50 ${n.accent}`}>
                              <n.icon size={14} />
                            </div>
                            <div>
                              <p className="text-xs text-slate-300 group-hover:text-white leading-relaxed">{n.message}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center text-slate-500 text-xs">Yeni bildirim yok</div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <button onClick={toggleTheme} className="p-2 text-slate-300 hover:text-white transition-colors">
                {isDark ? <Sun size={22} /> : <Moon size={22} />}
              </button>

              <button onClick={logout} className="p-2 text-slate-400 hover:text-red-400 transition-colors">
                <LogOut size={22} />
              </button>
            </div>
          </div>
        </header>

        {/* Content - 6x3 Grid Layout (No scroll, fits screen) */}
        <div className="flex-1 w-full max-w-[1400px] mx-auto p-4 sm:p-6 grid grid-cols-6 grid-rows-3 gap-4 min-h-0">

          {/* Match Card (Starts Col 0, Spans 3 Cols, Spans 2 Rows) [Indices: 0,0 - 2,1] */}
          <div className={`col-span-3 row-span-2 group relative rounded-xl overflow-hidden shadow-2xl transition-transform hover:scale-[1.01] duration-300 border ${isDark ? 'border-white/10' : 'border-white/40'}`}>
            <div className="absolute inset-0 z-0">
              <div className="absolute inset-0 bg-gradient-to-r from-yellow-500 via-white to-red-500 opacity-90" />
              <img src={matchCardBg} alt="Match Bg" className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-50" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            </div>

            {/* Sabitlenmiş Sol Üst Badge */}
            <div className="absolute top-0 left-0 z-20">
              <div className="bg-slate-900 text-white text-[10px] font-bold px-3 py-1 rounded-br-xl border-r border-b border-white/20 uppercase tracking-wider shadow-lg">
                {matchHighlight?.competition || 'LİG MAÇI'}
              </div>
            </div>

            <div className="relative z-10 w-full h-full flex flex-col items-center justify-center p-4">
              <div className="flex items-center justify-center w-full gap-2 sm:gap-6 lg:gap-8">
                {/* Home Team */}
                <div className="flex flex-col items-center gap-2 w-32">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 drop-shadow-2xl transition-transform group-hover:scale-110 duration-500">
                    {renderLogo(matchHighlight?.team?.logo, 'Home', 'w-full h-full')}
                  </div>
                  <span className="text-white font-bold text-shadow-sm text-xs sm:text-base text-center leading-tight line-clamp-2 w-full">
                    {matchHighlight?.team?.name}
                  </span>
                </div>

                {/* VS */}
                <div className="flex flex-col items-center shrink-0 mb-6">
                  <span className="text-5xl sm:text-6xl font-black italic text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] stroke-black tracking-tighter transform -skew-x-12">VS</span>
                </div>

                {/* Away Team */}
                <div className="flex flex-col items-center gap-2 w-32">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 drop-shadow-2xl transition-transform group-hover:scale-110 duration-500">
                    {renderLogo(matchHighlight?.opponent?.logo, 'Away', 'w-full h-full')}
                  </div>
                  <span className="text-white font-bold text-shadow-sm text-xs sm:text-base text-center leading-tight line-clamp-2 w-full">
                    {matchHighlight?.opponent?.name}
                  </span>
                </div>
              </div>
            </div>

            {/* Tarih / Saat - Kompakt */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
              <div className="bg-slate-800/90 backdrop-blur-md border border-white/20 px-4 py-1 rounded-lg shadow-xl text-center min-w-[100px]">
                <div className="text-gray-300 text-[9px] uppercase font-bold tracking-widest leading-none mb-0.5">{matchHighlight?.dateText || 'BUGUN'}</div>
                <div className="text-white text-lg font-black tracking-wider leading-none">{matchHighlight?.timeText || '21:00'}</div>
              </div>
            </div>
          </div>

          {/* Altyapi (Col 3 [Index 3], Row 0) */}
          <MenuButton
            label="ALTYAPI" icon={iconYouth} onClick={() => navigate('/youth')}
            className={`col-span-1 ${isDark ? 'border-white/10' : 'border-white/60 shadow-blue-900/10'}`}
            bgClass={isDark ? "bg-slate-900" : "bg-gradient-to-br from-[#122e5d] to-[#1e58a3]"}
          />

          {/* Transfer (Starts Col 4 [Index 4], Row 0) */}
          <MenuButton
            label="TRANSFER" icon={iconTransfer} onClick={() => navigate('/transfer-market')}
            className={`col-span-1 ${isDark ? 'border-white/10' : 'border-white/60 shadow-blue-900/10'}`}
            bgClass={isDark ? "bg-slate-900" : "bg-gradient-to-b from-[#0f4c81] via-[#1e60a3] to-[#3b82f6]"}
            layout="vertical"
          />

          {/* Nostalgia Pack (Col 5, Row 0) */}
          <MenuButton
            label="NOSTALJİ" icon={iconNostalgia} onClick={() => navigate('/legend-pack')}
            className={`col-span-1 ${isDark ? 'border-white/10' : 'border-white/60 shadow-purple-900/10'}`}
            bgClass={isDark ? "bg-slate-900" : "bg-gradient-to-br from-[#5b21b6] to-[#7c3aed]"}
            layout="vertical"
          />

          {/* Ligler (Col 3 [Index 3], Row 1) */}
          <MenuButton
            label="LIGLER" icon={iconLeagues} onClick={() => navigate('/leagues')}
            className={`col-span-1 ${isDark ? 'border-white/10' : 'border-white/60 shadow-blue-900/10'}`}
            bgClass={isDark ? "bg-slate-900" : "bg-gradient-to-br from-[#1e4b8a] to-[#2563eb]"}
          />

          {/* NEW: Match Preview (Col 4, Row 1) */}
          <MenuButton
            label="MAC ONIZLEME" icon={iconMatchPreview} onClick={() => navigate('/match-preview')}
            className={`col-span-1 ${isDark ? 'border-white/10' : 'border-white/60 shadow-blue-900/10'}`}
            bgClass={isDark ? "bg-slate-900" : "bg-gradient-to-br from-[#2c5282] to-[#2b6cb0]"}
            layout="vertical"
          />

          {/* NEW: Fixtures (Col 5, Row 1) */}
          <MenuButton
            label="FIKSTUR" icon={iconFixtures} onClick={() => navigate('/fixtures')}
            className={`col-span-1 ${isDark ? 'border-white/10' : 'border-white/60 shadow-blue-900/10'}`}
            bgClass={isDark ? "bg-slate-900" : "bg-gradient-to-br from-[#dd6b20] to-[#ed8936]"}
            layout="vertical"
          />

          {/* Bottom Row - Row 2 (Indices 0,2 to 5,2) */}

          {/* (0,2) Takim */}
          <MenuButton
            label="TAKIM YONETIMI" icon={iconTeam} onClick={() => navigate('/team-planning')}
            className={`col-span-1 border-b-4 border-green-500`} bgClass={isDark ? "bg-slate-900" : "bg-[#183a28]"} layout="vertical"
          />
          {/* (1,2) Arkadaslar */}
          <MenuButton
            label="ARKADASLAR" icon={iconFriends} onClick={() => navigate('/friends')}
            className={`col-span-1 border-b-4 border-purple-500`} bgClass={isDark ? "bg-slate-900" : "bg-[#2e1a47]"} layout="vertical"
          />
          {/* (2,2) NEW: Champions League */}
          <MenuButton
            label="SAMPIYONLAR LIGI" icon={iconChampions} onClick={() => navigate('/champions-league')}
            className={`col-span-1 border-b-4 border-sky-400`}
            bgClass={isDark ? "bg-slate-900" : "bg-[#2a4365]"}
            layout="vertical"
          />

          {/* (3,2) Antrenman */}
          <MenuButton
            label="ANTRENMAN" icon={iconTraining} onClick={() => navigate('/training')}
            className={`col-span-1 border-b-4 border-blue-500`} bgClass={isDark ? "bg-slate-900" : "bg-[#183152]"} layout="vertical"
          />
          {/* (4,2) Finans */}
          <MenuButton
            label="FINANS" icon={iconFinance} onClick={() => navigate('/finance')}
            className={`col-span-1 border-b-4 border-emerald-500`} bgClass={isDark ? "bg-slate-900" : "bg-[#104233]"} layout="vertical"
          />
          {/* (5,2) Ayarlar */}
          <MenuButton
            label="AYARLAR" icon={iconSettings} onClick={() => navigate('/settings')}
            className={`col-span-1 border-b-4 border-slate-500`} bgClass={isDark ? "bg-slate-900" : "bg-[#2d3748]"} layout="vertical"
          />

        </div>
      </div>



      <GlobalChatWidget />
    </div>
  );
}

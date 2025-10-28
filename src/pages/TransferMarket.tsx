import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { BackButton } from '@/components/ui/back-button';
import { Loader2, PlusCircle, ShoppingCart, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { Player, TransferListing } from '@/types';
import { getTeam } from '@/services/team';
import {
  createTransferListing,
  cancelTransferListing,
  listenAvailableTransferListings,
  listenUserTransferListings,
  purchaseTransferListing,
  type MarketSortOption,
} from '@/services/transferMarket';
import { getLegendIdFromPlayer } from '@/services/legends';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PlayerStatusCard } from '@/components/ui/player-status-card';
import { cn } from '@/lib/utils';
import { formatRatingLabel, normalizeRatingTo100 } from '@/lib/player';
import { NegotiationDialog, NegotiationContext } from '@/features/negotiation/NegotiationDialog';
import { finalizeNegotiationAttempt, recordTransferHistory, type NegotiationAttempt } from '@/services/negotiation';
import {
  syncTeamSalaries,
  ensureMonthlySalaryCharge,
  recordTransferExpense,
  recordTransferRefund,
  syncFinanceBalanceWithTeam,
} from '@/services/finance';
import { updatePlayerSalary } from '@/services/team';
import './transfer-market.css';
import { useTeamBudget } from '@/hooks/useTeamBudget';

const POSITIONS: Player['position'][] = [
  'GK',
  'CB',
  'LB',
  'RB',
  'CM',
  'LM',
  'RM',
  'CAM',
  'LW',
  'RW',
  'ST',
];

type SortOption = 'overall-desc' | 'overall-asc' | 'price-asc' | 'price-desc';

type FilterState = {
  position: 'all' | Player['position'];
  maxPrice: string;
  sortBy: SortOption;
};

type TransferMarketLocationState = {
  listPlayerId?: string;
} | null;

type FirestoreErrorLike = Error & { code?: string };

type MarketplaceErrorMessage = {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
};

const extractIndexLink = (message: string): string | null => {
  const match = message.match(/https:\/\/\S+/i);
  if (!match) return null;
  return match[0].replace(/[).,]$/, '');
};

const mapSortToService = (sort: SortOption): MarketSortOption => {
  switch (sort) {
    case 'overall-asc':
      return 'overall_asc';
    case 'price-asc':
      return 'price_asc';
    case 'price-desc':
      return 'price_desc';
    case 'overall-desc':
    default:
      return 'overall_desc';
  }
};

const formatPrice = (value: number) =>
  `${value.toLocaleString('tr-TR')} $`;

const formatOverall = (value: number) => formatRatingLabel(value);

const isFirestoreIndexError = (error: FirestoreErrorLike) => {
  const message = error.message ?? '';
  return error.code === 'failed-precondition' || message.includes('The query requires an index');
};

const resolveMarketplaceError = (error: unknown): MarketplaceErrorMessage => {
  const err =
    error instanceof Error
      ? (error as FirestoreErrorLike)
      : new Error(typeof error === 'string' ? error : String(error));

  if (isFirestoreIndexError(err)) {
    const indexLink = extractIndexLink(err.message ?? '');

    if (import.meta.env.DEV && indexLink) {
      return {
        title: 'Firestore indeksine ihtiyac var.',
        description: 'Eksik composite indexi olusturmak icin asagidaki baglantiyi kullan.',
        action: {
          label: 'Indeksi Olustur',
          onClick: () => {
            if (typeof window !== 'undefined') {
              window.open(indexLink, '_blank', 'noopener,noreferrer');
            }
          },
        },
      };
    }

    return {
      title: 'Veri yuklenemedi.',
    };
  }

  if (err.message.includes('permission')) {
    return {
      title: 'Pazar okunamiyor. Kurallari guncelliyor musunuz?',
    };
  }

  return {
    title: err.message || 'Beklenmedik bir hata olustu.',
  };
};

export default function TransferMarket() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [teamPlayers, setTeamPlayers] = useState<Player[]>([]);
  const [teamName, setTeamName] = useState<string>('');
  const [teamBudget, setTeamBudget] = useState<number>(0);
  const { budget: liveBudget, adjustBudget } = useTeamBudget();
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);
  const [listings, setListings] = useState<TransferListing[]>([]);
  const [myListings, setMyListings] = useState<TransferListing[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [isListing, setIsListing] = useState(false);
  const [purchasingId, setPurchasingId] = useState<string>('');
  const [isListingsLoading, setIsListingsLoading] = useState(true);
  const [isMyListingsLoading, setIsMyListingsLoading] = useState(false);
  const [isAddingFunds, setIsAddingFunds] = useState(false);
  const [cancellingId, setCancellingId] = useState<string>('');
  const [filters, setFilters] = useState<FilterState>({
    position: 'all',
    maxPrice: '',
    sortBy: 'overall-desc',
  });
  const [expandedListingId, setExpandedListingId] = useState<string | null>(null);
  const [negotiationOpen, setNegotiationOpen] = useState(false);
  const [negotiationContext, setNegotiationContext] = useState<NegotiationContext | null>(null);
  const [pendingListing, setPendingListing] = useState<TransferListing | null>(null);
  const previousListingCount = useRef<number>(0);
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.matchMedia('(min-width: 768px)').matches;
  });

  useEffect(() => {
    if (typeof liveBudget === 'number') {
      setTeamBudget(liveBudget);
    }
  }, [liveBudget]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia('(min-width: 768px)');
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    const handleChangeFallback = () => setIsDesktop(query.matches);

    setIsDesktop(query.matches);

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', handleChange);
      return () => query.removeEventListener('change', handleChange);
    }

    query.addListener(handleChangeFallback);
    return () => query.removeListener(handleChangeFallback);
  }, []);


  const locationState = location.state as TransferMarketLocationState;
  const targetPlayerFromState = locationState?.listPlayerId ?? '';

  const loadTeam = useCallback(async () => {
    if (!user) {
      setTeamPlayers([]);
      setTeamName('Takimim');
      setTeamBudget(0);
      return;
    }
    setIsLoadingTeam(true);
    try {
      const team = await getTeam(user.id);
      setTeamPlayers(team?.players ?? []);
      setTeamName(team?.name ?? user.teamName ?? 'Takimim');
      const nextBudget = Number.isFinite(team?.transferBudget)
        ? Number(team?.transferBudget)
        : Number.isFinite(team?.budget)
          ? Number(team?.budget)
          : 0;
      setTeamBudget(nextBudget);
    } catch (error) {
      console.error('[TransferMarket] takimi yukleme hatasi', error);
      toast.error('Takim bilgileri alinamadi.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsLoadingTeam(false);
    }
  }, [user]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  useEffect(() => {
    if (!user) {
      setListings([]);
      setIsListingsLoading(false);
      return;
    }

    let isMounted = true;
    setIsListingsLoading(true);

    const rawMaxPrice = Number(filters.maxPrice);
    const maxPrice = Number.isFinite(rawMaxPrice) && rawMaxPrice > 0 ? rawMaxPrice : undefined;

    const unsubscribe = listenAvailableTransferListings(
      {
        pos: filters.position === 'all' ? undefined : filters.position,
        maxPrice,
        sort: mapSortToService(filters.sortBy),
      },
      list => {
        if (!isMounted) return;
        setListings(list);
        setExpandedListingId(prev =>
          prev && list.some(item => item.id === prev) ? prev : null,
        );
        setIsListingsLoading(false);
      },
      error => {
        if (!isMounted) return;
        console.error('[TransferMarket] marketplace listen error', error);
        const message = resolveMarketplaceError(error);
        const toastOptions: Parameters<typeof toast.error>[1] = {};
        if (message.description) {
          toastOptions.description = message.description;
        }
        if (message.action) {
          toastOptions.action = {
            label: message.action.label,
            onClick: message.action.onClick,
          };
        }
        if (Object.keys(toastOptions).length > 0) {
          toast.error(message.title, toastOptions);
        } else {
          toast.error(message.title);
        }
        setListings([]);
        setIsListingsLoading(false);
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [filters.maxPrice, filters.position, filters.sortBy, user]);

  useEffect(() => {
    if (!user?.id) {
      setMyListings([]);
      setIsMyListingsLoading(false);
      return;
    }

    let isMounted = true;
    setIsMyListingsLoading(true);

    const unsubscribe = listenUserTransferListings(
      user.id,
      list => {
        if (!isMounted) return;
        setMyListings(list);
        setIsMyListingsLoading(false);
      },
      error => {
        if (!isMounted) return;
        console.error('[TransferMarket] my listings listen error', error);
        const message = resolveMarketplaceError(error);
        const toastOptions: Parameters<typeof toast.error>[1] = {};
        if (message.description) {
          toastOptions.description = message.description;
        }
        if (message.action) {
          toastOptions.action = {
            label: message.action.label,
            onClick: message.action.onClick,
          };
        }
        if (Object.keys(toastOptions).length > 0) {
          toast.error(message.title, toastOptions);
        } else {
          toast.error(message.title);
        }
        setMyListings([]);
        setIsMyListingsLoading(false);
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    if (previousListingCount.current > myListings.length) {
      loadTeam();
    }
    previousListingCount.current = myListings.length;
  }, [loadTeam, myListings.length, user]);

  const availablePlayers = useMemo(() => {
    const listedIds = new Set(myListings.map(listing => listing.playerId));
    return teamPlayers.filter(player => {
      if (listedIds.has(player.id)) {
        return false;
      }
      if (player.market?.locked) {
        return false;
      }
      if (getLegendIdFromPlayer(player) !== null) {
        return false;
      }
      return true;
    });
  }, [myListings, teamPlayers]);

  useEffect(() => {
    if (!targetPlayerFromState) {
      return;
    }
    if (teamPlayers.length === 0) {
      return;
    }

    if (availablePlayers.some(player => player.id === targetPlayerFromState)) {
      setSelectedPlayerId(targetPlayerFromState);
      setPrice('');
    } else {
      const targetPlayer = teamPlayers.find(player => player.id === targetPlayerFromState);
      if (targetPlayer?.market?.locked || (targetPlayer && getLegendIdFromPlayer(targetPlayer) !== null)) {
        toast.error('Oyuncu pazara eklenemiyor.', {
          description: 'Nostalji paketinden alinan oyuncular transfer pazarinda satilamaz.',
        });
      } else {
        toast.error('Oyuncu pazara eklenemiyor.', {
          description: 'Oyuncu zaten listede olabilir veya kadroda bulunmuyor.',
        });
      }
    }

    navigate(location.pathname, { replace: true, state: null });
  }, [availablePlayers, location.pathname, navigate, targetPlayerFromState, teamPlayers.length]);

  const renderDesktopListings = () => {
    if (isListingsLoading) {
      return (
        <TableRow>
          <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Ilanlar yukleniyor...
            </div>
          </TableCell>
        </TableRow>
      );
    }

    if (listings.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
            Filtrenize uyan aktif ilan bulunamadi.
          </TableCell>
        </TableRow>
      );
    }

    return listings.map(listing => {
      const player = listing.player;
      const name = player?.name ?? listing.playerName ?? 'Bilinmeyen Oyuncu';
      const position = player?.position ?? listing.pos ?? 'N/A';
      const overallValue = player?.overall ?? listing.overall ?? 0;
      const potentialValue = player?.potential ?? overallValue;
      const ageDisplay = player?.age ?? '-';
      const sellerUid = listing.sellerUid ?? listing.sellerId;
      const isExpanded = expandedListingId === listing.id;

      return (
        <TableRow
          key={listing.id}
          className={cn(
            'transition-colors',
            isExpanded && 'bg-emerald-500/10',
          )}
        >
          <TableCell>
            {player ? (
              <Popover
                open={isExpanded}
                onOpenChange={open => {
                  setExpandedListingId(prev => {
                    if (open) {
                      return listing.id;
                    }
                    return prev === listing.id ? null : prev;
                  });
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'group flex w-full flex-col items-start rounded-md border border-transparent px-0 py-1 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
                      isExpanded &&
                        'border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-900/40',
                    )}
                  >
                    <span className="font-semibold text-foreground transition-colors group-hover:text-emerald-700 dark:group-hover:text-emerald-200">
                      {name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Yas {ageDisplay} - Potansiyel {formatOverall(potentialValue)}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align={isDesktop ? 'start' : 'center'}
                  side={isDesktop ? 'right' : 'bottom'}
                  sideOffset={isDesktop ? 16 : 8}
                  className="w-[min(320px,80vw)] border-none bg-transparent p-0 shadow-none"
                >
                  <PlayerStatusCard player={player} />
                </PopoverContent>
              </Popover>
            ) : (
              <div>
                <div className="font-semibold">{name}</div>
                <div className="text-xs text-muted-foreground">
                  Yas {ageDisplay} - Potansiyel {formatOverall(potentialValue)}
                </div>
              </div>
            )}
          </TableCell>
          <TableCell>
            <Badge variant="outline" className="border-white/20 bg-white/5 text-slate-100">
              {position}
            </Badge>
          </TableCell>
          <TableCell className="text-slate-200">{formatOverall(overallValue)}</TableCell>
          <TableCell className="text-slate-300">{listing.sellerTeamName}</TableCell>
          <TableCell className="font-semibold text-emerald-300">
            {formatPrice(listing.price)}
          </TableCell>
          <TableCell className="text-right">
            <Button
              size="sm"
              onClick={() => handlePurchase(listing)}
              disabled={
                sellerUid === user?.id ||
                purchasingId === listing.id ||
                teamBudget < listing.price
              }
              className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
            >
              {purchasingId === listing.id ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Islem Yapiliyor
                </>
              ) : (
                'Satin Al'
              )}
            </Button>
          </TableCell>
        </TableRow>
      );
    });
  };

  const renderMobileListings = () => {
    if (isListingsLoading) {
      return (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 py-6 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Ilanlar yukleniyor...
        </div>
      );
    }

    if (listings.length === 0) {
      return (
        <div className="rounded-xl border border-white/20 bg-white/5 p-4 text-center text-sm text-slate-300">
          Filtrenize uyan aktif ilan bulunamadi.
        </div>
      );
    }

    return listings.map(listing => {
      const player = listing.player;
      const name = player?.name ?? listing.playerName ?? 'Bilinmeyen Oyuncu';
      const position = player?.position ?? listing.pos ?? 'N/A';
      const overallValue = player?.overall ?? listing.overall ?? 0;
      const potentialValue = player?.potential ?? overallValue;
      const ageDisplay = player?.age ?? '-';
      const sellerUid = listing.sellerUid ?? listing.sellerId;

      return (
        <div
          key={listing.id}
          className="transfer-market-mobile-card"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-foreground">{name}</div>
              <div className="text-xs text-muted-foreground">
                Yas {ageDisplay} - Potansiyel {formatOverall(potentialValue)}
              </div>
            </div>
            <Badge variant="outline" className="border-white/20 bg-white/5 text-slate-100">
              {position}
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Guc Ortalamasi</span>
              <div>{formatOverall(overallValue)}</div>
            </div>
            <div>
              <span className="font-medium text-foreground">Satici</span>
              <div>{listing.sellerTeamName}</div>
            </div>
            <div>
              <span className="font-medium text-foreground">Fiyat</span>
              <div className="transfer-market-mobile-card__price">{formatPrice(listing.price)}</div>
            </div>
          </div>
          <Button
            className="mt-4 w-full bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
            onClick={() => handlePurchase(listing)}
            disabled={
              sellerUid === user?.id ||
              purchasingId === listing.id ||
              teamBudget < listing.price
            }
          >
            {purchasingId === listing.id ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Islem Yapiliyor
              </>
            ) : (
              'Satin Al'
            )}
          </Button>
        </div>
      );
    });
  };

  const handleAddFunds = async () => {
    if (!user) {
      toast.error('Giris yapmalisin.');
      return;
    }

    setIsAddingFunds(true);
    try {
      const updatedBudget = await adjustBudget(10_000);
      if (typeof updatedBudget === 'number') {
        setTeamBudget(updatedBudget);
      }
      await syncFinanceBalanceWithTeam(user.id).catch(err =>
        console.warn('[TransferMarket] finance sync failed after funds add', err),
      );
      toast.success('Takim butcene 10.000 $ eklendi.');
    } catch (error) {
      console.error('[TransferMarket] budget adjust error', error);
      toast.error('Butce guncellenemedi.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsAddingFunds(false);
    }
  };

  const handleCreateListing = async () => {
    if (!user) {
      toast.error('Giris yapmalisin.');
      return;
    }
    const player = availablePlayers.find(p => p.id === selectedPlayerId);
    if (!player) {
      toast.error('Pazara koymak icin bir oyuncu sec.');
      return;
    }
    if (player.market?.locked || getLegendIdFromPlayer(player) !== null) {
      toast.error('Bu oyuncu transfer pazarinda satilamaz.');
      return;
    }
    const priceValue = Number(price);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      toast.error('Gecerli bir fiyat gir.');
      return;
    }

    setIsListing(true);
    try {
      await createTransferListing({
        player,
        price: priceValue,
      });
      toast.success(`${player.name} transfer pazarina eklendi.`);
      setSelectedPlayerId('');
      setPrice('');
      await loadTeam();
    } catch (error) {
      toast.error('Ilan olusturulamadi.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsListing(false);
    }
  };

  const handleCancelListing = async (listingId: string) => {
    if (!user) {
      toast.error('Giris yapmalisin.');
      return;
    }

    setCancellingId(listingId);
    try {
      await cancelTransferListing(listingId);
      toast.success('Ilan transfer pazarindan kaldirildi.');
      await loadTeam();
    } catch (error) {
      toast.error('Ilan kaldirilamadi.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setCancellingId('');
    }
  };

  const handlePurchase = async (listing: TransferListing) => {
    if (!user) {
      toast.error('Giris yapmalisin.');
      return;
    }
    const sellerUid = listing.sellerUid ?? listing.sellerId;
    if (sellerUid === user.id) {
      toast.error('Kendi oyuncunu satin alamazsin.');
      return;
    }

    if (teamBudget < listing.price) {
      toast.error('Butcen yetersiz.', {
        description: 'Satin alma testleri icin sagdaki butondan butcene 10.000 $ ekleyebilirsin.',
      });
      return;
    }

    const player = listing.player;
    if (!player) {
      toast.error('Oyuncu bilgisi eksik.');
      return;
    }
    const baseOverall = player.overall ?? listing.overall ?? 0;
    const overallRating = normalizeRatingTo100(baseOverall);

    setExpandedListingId(prev => (prev === listing.id ? null : prev));
    setPendingListing(listing);
    setNegotiationContext({
      playerId: player.id,
      playerName: player.name,
      overall: overallRating,
      position: player.position ?? listing.pos,
      transferFee: listing.price,
      source: 'transfer',
      contextId: listing.id,
    });
    setNegotiationOpen(true);
  };

  const handleNegotiationAccepted = async ({ salary, attempt }: { salary: number; attempt: NegotiationAttempt }) => {
    if (!user || !pendingListing) {
      return;
    }
    const listing = pendingListing;
    const contextId = attempt.contextId ?? listing.id;
    const transferAmount = attempt.transferFee ?? listing.price ?? 0;
    setPurchasingId(listing.id);
    try {
      await purchaseTransferListing(listing.id, user.id);
      await loadTeam();
      const syncedBalance = await syncFinanceBalanceWithTeam(user.id).catch(err => {
        console.warn('[TransferMarket] finance balance sync failed', err);
        return null;
      });
      if (typeof syncedBalance === 'number') {
        setTeamBudget(syncedBalance);
      }
      if (transferAmount > 0) {
        await recordTransferExpense(user.id, {
          amount: transferAmount,
          playerName: attempt.playerName,
          contextId,
        }).catch(err => console.warn('[TransferMarket] transfer expense log failed', err));
      }
      const playerId = listing.player?.id ?? attempt.playerId;
      if (playerId) {
        await updatePlayerSalary(user.id, playerId, salary);
        await syncTeamSalaries(user.id);
      } else {
        await syncTeamSalaries(user.id);
      }
      await ensureMonthlySalaryCharge(user.id).catch(() => undefined);
      await finalizeNegotiationAttempt(user.id, attempt.id, { accepted: true, salary });
      await recordTransferHistory(user.id, {
        playerId: attempt.playerId,
        playerName: attempt.playerName,
        overall: attempt.overall,
        transferFee: attempt.transferFee,
        salary,
        source: 'transfer',
        attemptId: attempt.id,
        contextId,
        accepted: true,
      });
      const displayName = listing.player?.name ?? attempt.playerName;
      toast.success(`${displayName} takimina katildi!`);
    } catch (error) {
      console.error('[TransferMarket] negotiation purchase failed', error);
      toast.error('Satin alma basarisiz.', {
        description: error instanceof Error ? error.message : undefined,
      });
      if (user) {
        await finalizeNegotiationAttempt(user.id, attempt.id, { accepted: false });
      }
    } finally {
      setPurchasingId('');
      setNegotiationOpen(false);
      setPendingListing(null);
      setNegotiationContext(null);
    }
  };

  const handleNegotiationRejected = async ({ attempt }: { attempt: NegotiationAttempt }) => {
    const listing = pendingListing;
    if (user) {
      await finalizeNegotiationAttempt(user.id, attempt.id, { accepted: false });
      const contextId = attempt.contextId ?? listing?.id ?? attempt.playerId;
      const refundAmount = attempt.transferFee ?? listing?.price ?? 0;
      const syncedBalance = await syncFinanceBalanceWithTeam(user.id).catch(err => {
        console.warn('[TransferMarket] finance balance sync failed', err);
        return null;
      });
      if (typeof syncedBalance === 'number') {
        setTeamBudget(syncedBalance);
      }
      if (refundAmount > 0) {
        await recordTransferRefund(user.id, {
          amount: refundAmount,
          playerName: attempt.playerName,
          contextId,
        }).catch(err => console.warn('[TransferMarket] transfer refund log failed', err));
      }
      await recordTransferHistory(user.id, {
        playerId: attempt.playerId,
        playerName: attempt.playerName,
        overall: attempt.overall,
        transferFee: attempt.transferFee,
        source: 'transfer',
        attemptId: attempt.id,
        contextId,
        accepted: false,
      });
    }
    setNegotiationOpen(false);
    setPendingListing(null);
    setNegotiationContext(null);
  };

  return (
    <div className="transfer-market-page">
      <div className="transfer-market-gradient" />
      <div className="transfer-market-orb transfer-market-orb--left" />
      <div className="transfer-market-orb transfer-market-orb--right" />
      <div className="transfer-market-noise" />
      <div className="transfer-market-shell">
        <header className="transfer-market-header">
          <div className="transfer-market-header__main">
            <BackButton />
            <div className="transfer-market-header__title">
              <h1>Transfer Pazari</h1>
              <p>
                Oyuncularini pazara cikar, eksik bolgeler icin yeni yildizlar kesfet. Mevkilere, ortalama guce ve fiyata gore
                filtreleyerek hedefledigin transferi kolayca bul.
              </p>
            </div>
          </div>
          <div className="transfer-market-summary">
            <div className="transfer-market-summary__icon">
              <Shield className="h-6 w-6" />
            </div>
            <div className="transfer-market-summary__info">
              <span>Takim</span>
              <strong>{teamName || user?.teamName || 'Takimim'}</strong>
            </div>
            <div className="transfer-market-summary__info">
              <span>Butce</span>
              <strong>{formatPrice(teamBudget)}</strong>
            </div>
          </div>
        </header>

        <div className="transfer-market-layout">
          <Card className={cn('transfer-market-card', 'overflow-hidden')}>
            <CardHeader className={cn('transfer-market-card__header')}>
              <CardTitle className="flex items-center gap-2 text-xl">
                <ShoppingCart className="h-5 w-5 text-emerald-300" />
                Pazardaki Oyuncular
              </CardTitle>
              <div className="transfer-market-card__filters">
                <div>
                  <label className="text-xs font-medium uppercase text-slate-300">Mevki</label>
                  <Select
                    value={filters.position}
                    onValueChange={value =>
                      setFilters(prev => ({ ...prev, position: value as FilterState['position'] }))
                    }
                  >
                    <SelectTrigger className="border-white/20 bg-slate-900/60 text-slate-100">
                      <SelectValue placeholder="Mevki sec" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tumu</SelectItem>
                      {POSITIONS.map(position => (
                        <SelectItem key={position} value={position}>
                          {position}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium uppercase text-slate-300">Maksimum Fiyat</label>
                  <Input
                    inputMode="numeric"
                    type="number"
                    min={0}
                    placeholder="Orn. 500000"
                    value={filters.maxPrice}
                    onChange={event =>
                      setFilters(prev => ({ ...prev, maxPrice: event.target.value }))
                    }
                    className="border-white/20 bg-slate-900/60 text-slate-100 placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase text-slate-300">Siralama</label>
                  <Select
                    value={filters.sortBy}
                    onValueChange={value =>
                      setFilters(prev => ({ ...prev, sortBy: value as SortOption }))
                    }
                  >
                    <SelectTrigger className="border-white/20 bg-slate-900/60 text-slate-100">
                      <SelectValue placeholder="Sirala" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="overall-desc">Guc (Yuksek → Dusuk)</SelectItem>
                      <SelectItem value="overall-asc">Guc (Dusuk → Yuksek)</SelectItem>
                      <SelectItem value="price-asc">Fiyat (Dusuk → Yuksek)</SelectItem>
                      <SelectItem value="price-desc">Fiyat (Yuksek → Dusuk)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isDesktop ? (
                <div className="transfer-market-card__table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Oyuncu</TableHead>
                        <TableHead>Mevki</TableHead>
                        <TableHead>Guc Ortalamasi</TableHead>
                        <TableHead>Satici</TableHead>
                        <TableHead>Fiyat</TableHead>
                        <TableHead className="text-right">Islem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{renderDesktopListings()}</TableBody>
                  </Table>
                </div>
              ) : (
                <div className="transfer-market-mobile-listings p-6">
                  {renderMobileListings()}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="transfer-market-aside">
            <div className="transfer-market-budget">
              <div className="flex items-center justify-between">
                <div>
                  <p className="transfer-market-budget__label">Kalan Butce</p>
                  <p className="transfer-market-budget__value">{formatPrice(teamBudget)}</p>
                </div>
                <Button
                  variant="outline"
                  onClick={handleAddFunds}
                  disabled={isAddingFunds || !user}
                  className="border-white/20 bg-white/5 text-slate-100 hover:bg-emerald-500/20"
                >
                  {isAddingFunds ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Ekleniyor
                    </>
                  ) : (
                    '+10.000 $ Ekle'
                  )}
                </Button>
              </div>
              <p className="mt-4 text-xs text-slate-400">
                Test amacli butcene hizlica para eklemek icin bu butonu kullanabilirsin. Islem Firebase uzerinde kaydedilir.
              </p>
            </div>

            <div className="transfer-market-form">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                <PlusCircle className="h-5 w-5 text-emerald-300" />
                Oyuncu Ilani Olustur
              </h2>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-xs font-medium uppercase text-slate-300">Oyuncu Sec</label>
                  <Select
                    value={selectedPlayerId}
                    onValueChange={value => setSelectedPlayerId(value)}
                    disabled={availablePlayers.length === 0 || isListing || isLoadingTeam}
                  >
                    <SelectTrigger className="border-white/20 bg-slate-900/60 text-slate-100">
                      <SelectValue
                        placeholder={
                          isLoadingTeam
                            ? 'Takim yukleniyor...'
                            : availablePlayers.length === 0
                              ? 'Pazara koyabilecegin oyuncu kalmadi'
                              : 'Oyuncu sec'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availablePlayers.map(player => (
                        <SelectItem key={player.id} value={player.id}>
                          {player.name} - {player.position} - Overall {formatOverall(player.overall)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium uppercase text-slate-300">Satis Fiyati ($)</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step="10000"
                    placeholder="Orn. 250000"
                    value={price}
                    onChange={event => setPrice(event.target.value)}
                    disabled={isListing}
                    className="border-white/20 bg-slate-900/60 text-slate-100 placeholder:text-slate-500"
                  />
                </div>
                <Button
                  className="w-full bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                  onClick={handleCreateListing}
                  disabled={!selectedPlayerId || !price || isListing}
                >
                  {isListing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Ilan Olusturuluyor
                    </>
                  ) : (
                    'Pazara Ekle'
                  )}
                </Button>
                <p className="text-xs text-slate-400">
                  Ilan verdigin oyuncular satilana kadar kadronda gorunmeye devam eder. Satis gerceklestiginde oyuncu yeni
                  takimina otomatik olarak transfer edilir.
                </p>
              </div>
            </div>

            <div className="transfer-market-listings">
              <h2 className="text-lg font-semibold text-white">Aktif Ilanlarin</h2>
              <div className="mt-4">
                {isMyListingsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Ilanlarin yukleniyor...
                  </div>
                ) : myListings.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Su anda pazarda aktif ilanlarin bulunmuyor.
                  </p>
                ) : (
                  <ul>
                    {myListings.map(listing => {
                      const player = listing.player;
                      const name = player?.name ?? listing.playerName ?? 'Bilinmeyen Oyuncu';
                      const position = player?.position ?? listing.pos ?? 'N/A';
                      const overallValue = player?.overall ?? listing.overall ?? 0;

                      return (
                        <li key={listing.id}>
                          <div className="flex flex-col">
                            <span>{name}</span>
                            <span className="text-xs text-slate-400">
                              {position} - Overall {formatOverall(overallValue)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span>{formatPrice(listing.price)}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCancelListing(listing.id)}
                              disabled={cancellingId === listing.id}
                              className="border-white/20 bg-white/5 text-slate-100 hover:bg-emerald-500/20"
                            >
                              {cancellingId === listing.id ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Kaldiriliyor
                                </>
                              ) : (
                                'Kaldir'
                              )}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <NegotiationDialog
        open={negotiationOpen}
        context={negotiationContext}
        onClose={() => {
          setNegotiationOpen(false);
          setPendingListing(null);
          setNegotiationContext(null);
        }}
        onAccepted={handleNegotiationAccepted}
        onRejected={handleNegotiationRejected}
      />

    </div>
  );
}
// Used path for listings: transferListings
// Added callables: marketCreateListing, marketCancelListing
// Updated marketplace UI/services.
// Rules block added.
// Indexes added.

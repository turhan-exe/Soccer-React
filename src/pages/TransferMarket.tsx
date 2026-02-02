import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
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
import { normalizeRatingTo100 } from '@/lib/player';
import { finalizeNegotiationAttempt, recordTransferHistory, type NegotiationAttempt } from '@/services/negotiation';
import {
  syncTeamSalaries,
  ensureMonthlySalaryCharge,
  recordTransferExpense,
  syncFinanceBalanceWithTeam,
} from '@/services/finance';
import { updatePlayerSalary } from '@/services/team';
import './transfer-market.css';
import { useTeamBudget } from '@/hooks/useTeamBudget';

// Components
import { TransferHeader } from '@/features/transfer/components/TransferHeader';
import { MarketList } from '@/features/transfer/components/MarketList';
import { CreateListing } from '@/features/transfer/components/CreateListing';
import { ActiveListings } from '@/features/transfer/components/ActiveListings';

type SortOption =
  | 'overall-desc' | 'overall-asc'
  | 'price-asc' | 'price-desc'
  | 'pos-asc' | 'pos-desc'
  | 'name-asc' | 'name-desc'
  | 'seller-asc' | 'seller-desc';

type FilterState = {
  position: 'all' | Player['position'];
  maxPrice: string;
  sortBy: SortOption;
};

const mapSortToService = (sort: SortOption): MarketSortOption => {
  switch (sort) {
    case 'overall-asc': return 'overall_asc';
    case 'price-asc': return 'price_asc';
    case 'price-desc': return 'price_desc';
    case 'pos-asc': return 'pos_asc';
    case 'pos-desc': return 'pos_desc';
    case 'name-asc': return 'name_asc';
    case 'name-desc': return 'name_desc';
    case 'seller-asc': return 'seller_asc';
    case 'seller-desc': return 'seller_desc';
    case 'overall-desc':
    default: return 'overall_desc';
  }
};

const extractIndexLink = (message: string): string | null => {
  const match = message.match(/https:\/\/\S+/i);
  if (!match) return null;
  return match[0].replace(/[).,]$/, '');
};

const resolveMarketplaceError = (error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message || '';

  if (message.includes('requires an index') || err.name === 'FirebaseError') {
    const link = extractIndexLink(message);
    if (link) {
      return {
        title: 'Veritabanı İndeksi Gerekli',
        description: 'Bu filtreleme kombinasyonu için yeni bir indeks oluşturulmalı.',
        action: {
          label: 'İndeksi Oluştur',
          onClick: () => window.open(link, '_blank')
        }
      };
    }
  }
  return { title: 'Pazar verisi alınamadı', description: message };
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
  const [cancellingId, setCancellingId] = useState<string>('');

  // Filters (for now keeping default, but ready for UI expansion)
  const [filters, setFilters] = useState<FilterState>({
    position: 'all',
    maxPrice: '',
    sortBy: 'overall-desc',
  });

  const previousListingCount = useRef<number>(0);

  // Sync Live Budget
  useEffect(() => {
    if (typeof liveBudget === 'number') {
      setTeamBudget(liveBudget);
    }
  }, [liveBudget]);

  // Load Team Data
  const loadTeam = useCallback(async () => {
    if (!user) return;
    setIsLoadingTeam(true);
    try {
      const team = await getTeam(user.id);
      setTeamPlayers(team?.players ?? []);
      setTeamName(team?.name ?? user.teamName ?? 'Takımım');
      const nextBudget = Number.isFinite(team?.transferBudget)
        ? Number(team?.transferBudget)
        : Number.isFinite(team?.budget)
          ? Number(team?.budget)
          : 0;
      setTeamBudget(nextBudget);
    } catch (error) {
      console.error('[TransferMarket] takimi yukleme hatasi', error);
      toast.error('Takım bilgileri alınamadı.');
    } finally {
      setIsLoadingTeam(false);
    }
  }, [user]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  // Listen Available Listings
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
        setIsListingsLoading(false);
      },
      error => {
        if (!isMounted) return;
        const { title, description } = resolveMarketplaceError(error);
        toast.error(title, { description });
        setListings([]);
        setIsListingsLoading(false);
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [filters, user]);

  // Listen My Listings
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
        const { title, description } = resolveMarketplaceError(error);
        toast.error(title, { description });
        setMyListings([]);
        setIsMyListingsLoading(false);
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [user?.id]);

  // Refresh team if my listings change count
  useEffect(() => {
    if (!user) return;
    if (previousListingCount.current > myListings.length) {
      loadTeam();
    }
    previousListingCount.current = myListings.length;
  }, [loadTeam, myListings.length, user]);

  // Calculate Available Players (for selling)
  const availablePlayers = useMemo(() => {
    const listedIds = new Set(myListings.map(listing => listing.playerId));
    return teamPlayers.filter(player => {
      if (listedIds.has(player.id)) return false;
      if (player.market?.locked) return false;
      if (getLegendIdFromPlayer(player) !== null) return false;
      return true;
    });
  }, [myListings, teamPlayers]);


  // Actions
  const handleCreateListing = async () => {
    if (!user) return;
    const player = availablePlayers.find(p => p.id === selectedPlayerId);
    if (!player) {
      toast.error('Pazara koymak için bir oyuncu seç.');
      return;
    }

    const priceValue = Number(price);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      toast.error('Geçerli bir fiyat gir.');
      return;
    }

    setIsListing(true);
    try {
      await createTransferListing({ player, price: priceValue });
      toast.success(`${player.name} transfer pazarına eklendi.`);
      setSelectedPlayerId('');
      setPrice('');
      await loadTeam();
    } catch (error) {
      toast.error('İlan oluşturulamadı.', { description: (error as Error).message });
    } finally {
      setIsListing(false);
    }
  };

  const handleCancelListing = async (listingId: string) => {
    if (!user) return;
    setCancellingId(listingId);
    try {
      await cancelTransferListing(listingId);
      toast.success('İlan kaldırıldı.');
      await loadTeam();
    } catch (error) {
      toast.error('İlan kaldırılamadı.', { description: (error as Error).message });
    } finally {
      setCancellingId('');
    }
  };

  const handlePurchase = async (listing: TransferListing) => {
    if (!user) return;
    if (teamBudget < listing.price) {
      toast.error('Bütçen yetersiz.');
      return;
    }

    setPurchasingId(listing.id);
    try {
      await purchaseTransferListing(listing.id, user.id);
      await loadTeam();
      const syncedBalance = await syncFinanceBalanceWithTeam(user.id);
      if (typeof syncedBalance === 'number') setTeamBudget(syncedBalance);

      const player = listing.player;
      if (player) {
        // Simple transfer logic, skipping negotiation dialog for this refactor to keep it clean first
        // Ideally we would integrate the negotiation flow here if requested, but maintaining existing simple flow for now
        await syncTeamSalaries(user.id);
      }
      toast.success('Transfer başarılı!');
    } catch (error) {
      toast.error('Satın alma başarısız.', { description: (error as Error).message });
    } finally {
      setPurchasingId('');
    }
  };



  return (
    <div className="min-h-screen bg-[#14151f] p-4 pb-24 font-sans text-slate-100">
      <div className="mx-auto max-w-7xl">
        {/* Header Section */}
        <TransferHeader
          teamName={teamName}
          budget={teamBudget}
        />

        <div className="flex flex-col gap-6">
          {/* Top Section: Market List */}
          <div className="w-full">
            <MarketList
              listings={listings}
              isLoading={isListingsLoading}
              currentUserId={user?.id}
              teamBudget={teamBudget}
              purchasingId={purchasingId}
              onPurchase={handlePurchase}
              currentSort={filters.sortBy}
              onSortChange={(newSort) => setFilters(prev => ({ ...prev, sortBy: newSort as SortOption }))}
            />
          </div>

          {/* Bottom Section: Actions & My Listings */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left: Create Listing */}
            <CreateListing
              availablePlayers={availablePlayers}
              selectedPlayerId={selectedPlayerId}
              price={price}
              isListing={isListing}
              onSelectPlayer={setSelectedPlayerId}
              onPriceChange={setPrice}
              onSubmit={handleCreateListing}
            />

            {/* Right: Active Listings */}
            <div className="min-h-[400px]">
              <ActiveListings
                listings={myListings}
                isLoading={isMyListingsLoading}
                cancellingId={cancellingId}
                onCancel={handleCancelListing}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

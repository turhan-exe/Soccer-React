import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/LanguageContext';
import { useClubFinance } from '@/hooks/useClubFinance';
import { getLegendIdFromPlayer } from '@/services/legends';
import { syncTeamSalaries } from '@/services/finance';
import { getTeam } from '@/services/team';
import {
  cancelTransferListing,
  createTransferListing,
  listenAvailableTransferListings,
  listenUserTransferListings,
  purchaseTransferListing,
  type MarketSortOption,
} from '@/services/transferMarket';
import type { Player, TransferListing } from '@/types';

import { ActiveListings } from '@/features/transfer/components/ActiveListings';
import { CreateListing } from '@/features/transfer/components/CreateListing';
import { MarketList } from '@/features/transfer/components/MarketList';
import { TransferHeader } from '@/features/transfer/components/TransferHeader';

import './transfer-market.css';

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

export default function TransferMarket() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [teamPlayers, setTeamPlayers] = useState<Player[]>([]);
  const [teamName, setTeamName] = useState<string>('');
  const { cashBalance: teamBudget } = useClubFinance();
  const [listings, setListings] = useState<TransferListing[]>([]);
  const [myListings, setMyListings] = useState<TransferListing[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [isListing, setIsListing] = useState(false);
  const [purchasingId, setPurchasingId] = useState<string>('');
  const [isListingsLoading, setIsListingsLoading] = useState(true);
  const [isMyListingsLoading, setIsMyListingsLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string>('');

  const [filters, setFilters] = useState<FilterState>({
    position: 'all',
    maxPrice: '',
    sortBy: 'overall-desc',
  });

  const previousListingCount = useRef<number>(0);

  const resolveMarketplaceError = useCallback((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message || '';

    if (message.includes('requires an index') || err.name === 'FirebaseError') {
      const link = extractIndexLink(message);
      if (link) {
        return {
          title: t('transfer.indexRequired'),
          description: t('transfer.indexRequiredDescription'),
          action: {
            label: t('transfer.createIndex'),
            onClick: () => window.open(link, '_blank'),
          },
        };
      }
    }

    return { title: t('transfer.marketDataError'), description: message };
  }, [t]);

  const loadTeam = useCallback(async () => {
    if (!user) return;
    try {
      const team = await getTeam(user.id);
      setTeamPlayers(team?.players ?? []);
      setTeamName(team?.name ?? user.teamName ?? t('transfer.myTeamFallback'));
    } catch (error) {
      console.error('[TransferMarket] team load failed', error);
      toast.error(t('transfer.teamLoadError'));
    }
  }, [t, user]);

  useEffect(() => {
    void loadTeam();
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
  }, [filters, resolveMarketplaceError, user]);

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
  }, [resolveMarketplaceError, user?.id]);

  useEffect(() => {
    if (!user) return;
    if (previousListingCount.current > myListings.length) {
      void loadTeam();
    }
    previousListingCount.current = myListings.length;
  }, [loadTeam, myListings.length, user]);

  const availablePlayers = useMemo(() => {
    const listedIds = new Set(myListings.map(listing => listing.playerId));
    return teamPlayers.filter(player => {
      if (listedIds.has(player.id)) return false;
      if (player.market?.locked) return false;
      if (getLegendIdFromPlayer(player) !== null) return false;
      return true;
    });
  }, [myListings, teamPlayers]);

  const handleCreateListing = async () => {
    if (!user) return;
    const player = availablePlayers.find(p => p.id === selectedPlayerId);
    if (!player) {
      toast.error(t('transfer.selectPlayerError'));
      return;
    }

    const priceValue = Number(price);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      toast.error(t('transfer.invalidPriceError'));
      return;
    }

    setIsListing(true);
    try {
      await createTransferListing({ player, price: priceValue });
      toast.success(t('transfer.createSuccess', { name: player.name }));
      setSelectedPlayerId('');
      setPrice('');
      await loadTeam();
    } catch (error) {
      toast.error(t('transfer.createError'), { description: (error as Error).message });
    } finally {
      setIsListing(false);
    }
  };

  const handleCancelListing = async (listingId: string) => {
    if (!user) return;
    setCancellingId(listingId);
    try {
      await cancelTransferListing(listingId);
      toast.success(t('transfer.cancelSuccess'));
      await loadTeam();
    } catch (error) {
      toast.error(t('transfer.cancelError'), { description: (error as Error).message });
    } finally {
      setCancellingId('');
    }
  };

  const handlePurchase = async (listing: TransferListing) => {
    if (!user) return;
    if (teamBudget < listing.price) {
      toast.error(t('transfer.insufficientBudget'));
      return;
    }

    setPurchasingId(listing.id);
    try {
      await purchaseTransferListing(listing.id, user.id);
      await loadTeam();

      if (listing.player) {
        await syncTeamSalaries(user.id);
      }

      toast.success(t('transfer.purchaseSuccess', {
        name: listing.player?.name ?? t('transfer.unknownPlayer'),
      }));
    } catch (error) {
      toast.error(t('transfer.purchaseError'), { description: (error as Error).message });
    } finally {
      setPurchasingId('');
    }
  };

  return (
    <div className="min-h-screen bg-[#14151f] p-4 pb-24 font-sans text-slate-100">
      <div className="mx-auto max-w-7xl">
        <TransferHeader teamName={teamName} budget={teamBudget} />

        <div className="flex flex-col gap-6">
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

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            <CreateListing
              availablePlayers={availablePlayers}
              selectedPlayerId={selectedPlayerId}
              price={price}
              isListing={isListing}
              onSelectPlayer={setSelectedPlayerId}
              onPriceChange={setPrice}
              onSubmit={handleCreateListing}
            />

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

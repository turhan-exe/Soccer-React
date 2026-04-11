import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';
import { getPositionShortLabel } from '@/lib/positionLabels';
import { formatRatingLabel } from '@/lib/player';
import { cn } from '@/lib/utils';
import { PlayerStatusCard } from '@/components/ui/player-status-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TransferListing } from '@/types';

const formatOverall = (value: number) => formatRatingLabel(value);

interface MarketListProps {
  listings: TransferListing[];
  isLoading: boolean;
  currentUserId?: string;
  teamBudget: number;
  purchasingId: string;
  onPurchase: (listing: TransferListing) => void;
  currentSort?: string;
  onSortChange?: (sort: string) => void;
}

export function MarketList({
  listings,
  isLoading,
  currentUserId,
  teamBudget,
  purchasingId,
  onPurchase,
  currentSort,
  onSortChange,
}: MarketListProps) {
  const { t, formatCurrency } = useTranslation();
  const [expandedListingId, setExpandedListingId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.matchMedia('(min-width: 768px)').matches);
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  const handleSort = (field: string) => {
    if (!onSortChange || !currentSort) return;

    let newDirection = 'desc';
    const [currentField, currentDir] = currentSort.split('-');

    if (field === currentField) {
      newDirection = currentDir === 'asc' ? 'desc' : 'asc';
    } else if (field === 'price' || field === 'name' || field === 'seller' || field === 'pos') {
      newDirection = 'asc';
    }

    onSortChange(`${field}-${newDirection}`);
  };

  const renderSortIcon = (field: string) => {
    if (!currentSort) return <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />;
    const [currentField, currentDir] = currentSort.split('-');

    if (field !== currentField) {
      return <ArrowUpDown className="ml-2 h-4 w-4 opacity-50 transition-opacity group-hover:opacity-100" />;
    }

    return currentDir === 'asc'
      ? <ArrowUp className="ml-2 h-4 w-4 text-indigo-400" />
      : <ArrowDown className="ml-2 h-4 w-4 text-indigo-400" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 py-12 text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {t('transfer.loadingListings')}
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-slate-400">
        {t('transfer.noListings')}
      </div>
    );
  }

  if (!isDesktop) {
    return (
      <div className="space-y-4">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-lg font-bold text-white">{t('transfer.marketPlayers')}</h2>
        </div>

        {listings.map((listing) => {
          const player = listing.player;
          const name = player?.name ?? listing.playerName ?? t('transfer.unknownPlayer');
          const position = getPositionShortLabel(player?.position ?? listing.pos ?? 'N/A');
          const overallValue = player?.overall ?? listing.overall ?? 0;
          const potentialValue = player?.potential ?? overallValue;
          const ageDisplay = player?.age ?? '-';
          const sellerUid = listing.sellerUid ?? listing.sellerId;
          const canBuy = sellerUid !== currentUserId && teamBudget >= listing.price;
          const isProcessing = purchasingId === listing.id;

          return (
            <div key={listing.id} className="relative overflow-hidden rounded-xl border border-white/10 bg-[#1e1f2e] p-4 shadow-lg transition-all active:scale-[0.99]">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/5 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-lg font-bold text-indigo-300">
                    {name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold text-slate-100">{name}</div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>{t('transfer.ageYears', { age: ageDisplay })}</span>
                      <span>•</span>
                      <span className="font-medium text-indigo-400">
                        {t('transfer.potential', { value: formatOverall(potentialValue) })}
                      </span>
                    </div>
                  </div>
                </div>
                <Badge variant="outline" className="border-white/10 bg-white/5 font-mono text-slate-300">
                  {position}
                </Badge>
              </div>

              <div className="mb-4 grid grid-cols-3 gap-2 border-b border-t border-white/5 py-3">
                <div className="text-center">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{t('transfer.seller')}</div>
                  <div className="mx-auto max-w-[80px] truncate text-xs font-medium text-slate-300">
                    {listing.sellerTeamName}
                  </div>
                </div>
                <div className="border-x border-white/5 text-center">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{t('transfer.overall')}</div>
                  <div className="text-sm font-bold text-white">{formatOverall(overallValue)}</div>
                </div>
                <div className="text-center">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{t('transfer.price')}</div>
                  <div className="text-sm font-bold text-emerald-400">{formatCurrency(listing.price)}</div>
                </div>
              </div>

              <Button
                className={cn(
                  'h-10 w-full font-bold tracking-wide transition-all',
                  canBuy
                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-900/20 hover:from-emerald-500 hover:to-emerald-400'
                    : 'cursor-not-allowed bg-slate-800 text-slate-500',
                )}
                onClick={() => onPurchase(listing)}
                disabled={!canBuy || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('transfer.processing')}
                  </>
                ) : (
                  t('transfer.buy')
                )}
              </Button>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#1e1f2e]/50 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <h2 className="text-lg font-bold text-white">{t('transfer.marketPlayers')}</h2>
        <Badge variant="secondary" className="border border-indigo-500/20 bg-indigo-500/10 text-indigo-300">
          {t('transfer.playersCount', { count: listings.length })}
        </Badge>
      </div>
      <Table>
        <TableHeader className="bg-white/5">
          <TableRow className="border-white/5 hover:bg-transparent">
            <TableHead className="group cursor-pointer font-bold text-slate-400 transition-colors hover:text-slate-200" onClick={() => handleSort('name')}>
              <div className="flex items-center">{t('transfer.player')} {renderSortIcon('name')}</div>
            </TableHead>
            <TableHead className="group cursor-pointer font-bold text-slate-400 transition-colors hover:text-slate-200" onClick={() => handleSort('pos')}>
              <div className="flex items-center">{t('transfer.position')} {renderSortIcon('pos')}</div>
            </TableHead>
            <TableHead className="group cursor-pointer font-bold text-slate-400 transition-colors hover:text-slate-200" onClick={() => handleSort('overall')}>
              <div className="flex items-center">{t('transfer.overall')} {renderSortIcon('overall')}</div>
            </TableHead>
            <TableHead className="group cursor-pointer font-bold text-slate-400 transition-colors hover:text-slate-200" onClick={() => handleSort('seller')}>
              <div className="flex items-center">{t('transfer.seller')} {renderSortIcon('seller')}</div>
            </TableHead>
            <TableHead className="group cursor-pointer font-bold text-slate-400 transition-colors hover:text-slate-200" onClick={() => handleSort('price')}>
              <div className="flex items-center">{t('transfer.price')} {renderSortIcon('price')}</div>
            </TableHead>
            <TableHead className="text-right font-bold text-slate-400">{t('transfer.action')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listings.map((listing) => {
            const player = listing.player;
            const name = player?.name ?? listing.playerName ?? t('transfer.unknownPlayer');
            const position = getPositionShortLabel(player?.position ?? listing.pos ?? 'N/A');
            const overallValue = player?.overall ?? listing.overall ?? 0;
            const potentialValue = player?.potential ?? overallValue;
            const ageDisplay = player?.age ?? '-';
            const sellerUid = listing.sellerUid ?? listing.sellerId;
            const isExpanded = expandedListingId === listing.id;
            const canBuy = sellerUid !== currentUserId && teamBudget >= listing.price;
            const isProcessing = purchasingId === listing.id;

            return (
              <TableRow
                key={listing.id}
                className={cn(
                  'border-white/5 transition-colors hover:bg-white/5',
                  isExpanded && 'bg-indigo-500/10 hover:bg-indigo-500/20',
                )}
              >
                <TableCell>
                  {player ? (
                    <Popover
                      open={isExpanded}
                      onOpenChange={(open) => setExpandedListingId(open ? listing.id : null)}
                    >
                      <PopoverTrigger asChild>
                        <button className="group rounded px-2 py-1 text-left transition-colors hover:bg-white/5">
                          <span className="font-bold text-slate-200 transition-colors group-hover:text-indigo-300">{name}</span>
                          <span className="block text-xs text-slate-500">
                            {t('transfer.ageYears', { age: ageDisplay })} • {t('transfer.potential', {
                              value: formatOverall(potentialValue),
                            })}
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" className="w-[300px] border-none bg-transparent p-0 shadow-none">
                        <PlayerStatusCard player={player} />
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <div className="font-bold text-slate-200">{name}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="border-white/10 bg-white/5 font-mono text-slate-300">
                    {position}
                  </Badge>
                </TableCell>
                <TableCell className="font-semibold text-white">{formatOverall(overallValue)}</TableCell>
                <TableCell className="text-slate-300">{listing.sellerTeamName}</TableCell>
                <TableCell className="font-semibold text-emerald-400">{formatCurrency(listing.price)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    className={cn(
                      canBuy
                        ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                        : 'cursor-not-allowed bg-slate-800 text-slate-500',
                    )}
                    onClick={() => onPurchase(listing)}
                    disabled={!canBuy || isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('transfer.processing')}
                      </>
                    ) : (
                      t('transfer.buy')
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PlayerStatusCard } from '@/components/ui/player-status-card';
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRatingLabel } from '@/lib/player';
import { TransferListing } from '@/types';
import { useState, useEffect } from 'react';

// Format helpers
const formatPrice = (value: number) => `${value.toLocaleString('tr-TR')} $`;
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
    const [expandedListingId, setExpandedListingId] = useState<string | null>(null);
    const [isDesktop, setIsDesktop] = useState(true);

    // Responsive check
    useEffect(() => {
        const checkDesktop = () => setIsDesktop(window.matchMedia('(min-width: 768px)').matches);
        checkDesktop();
        window.addEventListener('resize', checkDesktop);
        return () => window.removeEventListener('resize', checkDesktop);
    }, []);

    const handleSort = (field: string) => {
        if (!onSortChange || !currentSort) return;

        let newDirection = 'desc';
        // Current format convention: "field-direction" e.g. "price-asc"
        const [currentField, currentDir] = currentSort.split('-');

        if (field === currentField) {
            newDirection = currentDir === 'asc' ? 'desc' : 'asc';
        } else {
            // Default directions for new fields
            if (field === 'price') newDirection = 'asc';
            else if (field === 'name') newDirection = 'asc';
            else if (field === 'seller') newDirection = 'asc';
            else if (field === 'pos') newDirection = 'asc';
            else newDirection = 'desc'; // overall default desc
        }

        onSortChange(`${field}-${newDirection}`);
    };

    const renderSortIcon = (field: string) => {
        if (!currentSort) return <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />;
        const [currentField, currentDir] = currentSort.split('-');

        if (field !== currentField) return <ArrowUpDown className="ml-2 h-4 w-4 opacity-50 group-hover:opacity-100 transition-opacity" />;

        return currentDir === 'asc'
            ? <ArrowUp className="ml-2 h-4 w-4 text-indigo-400" />
            : <ArrowDown className="ml-2 h-4 w-4 text-indigo-400" />;
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12 text-slate-400 bg-white/5 rounded-xl border border-white/10">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                İlanlar yükleniyor...
            </div>
        );
    }

    if (listings.length === 0) {
        return (
            <div className="py-12 text-center text-slate-400 bg-white/5 rounded-xl border border-white/10">
                Filtrenize uyan aktif ilan bulunamadı.
            </div>
        );
    }

    // --- MOBILE VIEW (CARDS) ---
    if (!isDesktop) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between mb-2 px-1">
                    <h2 className="text-lg font-bold text-white">Pazardaki Oyuncular</h2>
                    {/* Minimal mobile sort could be added here if needed, keeping simple for now */}
                </div>

                {listings.map((listing) => {
                    const player = listing.player;
                    const name = player?.name ?? listing.playerName ?? 'Bilinmeyen Oyuncu';
                    const position = player?.position ?? listing.pos ?? 'N/A';
                    const overallValue = player?.overall ?? listing.overall ?? 0;
                    const potentialValue = player?.potential ?? overallValue;
                    const ageDisplay = player?.age ?? '-';
                    const sellerUid = listing.sellerUid ?? listing.sellerId;
                    const canBuy = sellerUid !== currentUserId && teamBudget >= listing.price;
                    const isProcessing = purchasingId === listing.id;

                    return (
                        <div key={listing.id} className="relative overflow-hidden rounded-xl border border-white/10 bg-[#1e1f2e] p-4 shadow-lg transition-all active:scale-[0.99]">
                            {/* Header Row */}
                            <div className="flex items-start justify-between gap-3 mb-4">
                                <div className="flex items-center gap-3">
                                    {/* Avatar / Initial */}
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/5 text-lg font-bold text-indigo-300">
                                        {name.charAt(0)}
                                    </div>
                                    <div>
                                        <div className="font-bold text-slate-100">{name}</div>
                                        <div className="flex items-center gap-2 text-xs text-slate-400">
                                            <span>{ageDisplay} Yaş</span>
                                            <span>•</span>
                                            <span className="text-indigo-400 font-medium">Potansiyel {formatOverall(potentialValue)}</span>
                                        </div>
                                    </div>
                                </div>
                                <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-300 font-mono">
                                    {position}
                                </Badge>
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-3 gap-2 py-3 border-t border-white/5 border-b mb-4">
                                <div className="text-center">
                                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Satıcı</div>
                                    <div className="text-xs font-medium text-slate-300 truncate max-w-[80px] mx-auto">{listing.sellerTeamName}</div>
                                </div>
                                <div className="text-center border-l border-white/5 border-r">
                                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Güç</div>
                                    <div className="text-sm font-bold text-white">{formatOverall(overallValue)}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Fiyat</div>
                                    <div className="text-sm font-bold text-emerald-400">{formatPrice(listing.price)}</div>
                                </div>
                            </div>

                            {/* Action */}
                            <Button
                                className={cn(
                                    "w-full h-10 font-bold tracking-wide transition-all",
                                    canBuy
                                        ? "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-900/20"
                                        : "bg-slate-800 text-slate-500 cursor-not-allowed"
                                )}
                                onClick={() => onPurchase(listing)}
                                disabled={!canBuy || isProcessing}
                            >
                                {isProcessing ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        İşlem Yapılıyor
                                    </>
                                ) : (
                                    'Satın Al'
                                )}
                            </Button>
                        </div>
                    );
                })}
            </div>
        );
    }

    // --- DESKTOP VIEW (TABLE) ---
    return (
        <div className="rounded-2xl border border-white/10 bg-[#1e1f2e]/50 backdrop-blur-sm overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Pazardaki Oyuncular</h2>
                <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                    {listings.length} Oyuncu
                </Badge>
            </div>
            <Table>
                <TableHeader className="bg-white/5">
                    <TableRow className="border-white/5 hover:bg-transparent">
                        <TableHead className="text-slate-400 font-bold cursor-pointer group hover:text-slate-200 transition-colors" onClick={() => handleSort('name')}>
                            <div className="flex items-center">Oyuncu {renderSortIcon('name')}</div>
                        </TableHead>
                        <TableHead className="text-slate-400 font-bold cursor-pointer group hover:text-slate-200 transition-colors" onClick={() => handleSort('pos')}>
                            <div className="flex items-center">Mevki {renderSortIcon('pos')}</div>
                        </TableHead>
                        <TableHead className="text-slate-400 font-bold cursor-pointer group hover:text-slate-200 transition-colors" onClick={() => handleSort('overall')}>
                            <div className="flex items-center">Güç Ortalaması {renderSortIcon('overall')}</div>
                        </TableHead>
                        <TableHead className="text-slate-400 font-bold cursor-pointer group hover:text-slate-200 transition-colors" onClick={() => handleSort('seller')}>
                            <div className="flex items-center">Satıcı {renderSortIcon('seller')}</div>
                        </TableHead>
                        <TableHead className="text-slate-400 font-bold cursor-pointer group hover:text-slate-200 transition-colors" onClick={() => handleSort('price')}>
                            <div className="flex items-center">Fiyat {renderSortIcon('price')}</div>
                        </TableHead>
                        <TableHead className="text-right text-slate-400 font-bold">İşlem</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {listings.map((listing) => {
                        const player = listing.player;
                        const name = player?.name ?? listing.playerName ?? 'Bilinmeyen Oyuncu';
                        const position = player?.position ?? listing.pos ?? 'N/A';
                        const overallValue = player?.overall ?? listing.overall ?? 0;
                        const potentialValue = player?.potential ?? overallValue;
                        const ageDisplay = player?.age ?? '-';
                        const sellerUid = listing.sellerUid ?? listing.sellerId;
                        const isExpanded = expandedListingId === listing.id;
                        const canBuy = sellerUid !== currentUserId && teamBudget >= listing.price;

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
                                                <button className="flex flex-col items-start px-2 py-1 rounded hover:bg-white/5 transition-colors text-left group">
                                                    <span className="font-bold text-slate-200 group-hover:text-indigo-300 transition-colors">{name}</span>
                                                    <span className="text-xs text-slate-500">
                                                        Yaş {ageDisplay} • Potansiyel {formatOverall(potentialValue)}
                                                    </span>
                                                </button>
                                            </PopoverTrigger>
                                            <PopoverContent
                                                side="right"
                                                className="w-[300px] border-none bg-transparent p-0 shadow-none"
                                            >
                                                <PlayerStatusCard player={player} />
                                            </PopoverContent>
                                        </Popover>
                                    ) : (
                                        <div>
                                            <div className="font-bold text-slate-200">{name}</div>
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-300">
                                        {position}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-white border border-white/10">
                                            {formatOverall(overallValue)}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="text-slate-400 text-sm">{listing.sellerTeamName}</TableCell>
                                <TableCell className="font-mono text-emerald-400 font-bold">
                                    {formatPrice(listing.price)}
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        size="sm"
                                        className={cn(
                                            "font-semibold shadow-lg shadow-emerald-900/10",
                                            canBuy
                                                ? "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30"
                                                : "bg-slate-800 text-slate-500 border border-white/5 cursor-not-allowed"
                                        )}
                                        onClick={() => onPurchase(listing)}
                                        disabled={!canBuy || purchasingId === listing.id}
                                    >
                                        {purchasingId === listing.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            'Satın Al'
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

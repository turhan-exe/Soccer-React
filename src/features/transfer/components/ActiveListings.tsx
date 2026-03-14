import { Button } from '@/components/ui/button';
import { Loader2, Trash2 } from 'lucide-react';
import { TransferListing } from '@/types';
import { formatRatingLabel } from '@/lib/player';

// Format helpers
const formatPrice = (value: number) => `${value.toLocaleString('tr-TR')} $`;

interface ActiveListingsProps {
    listings: TransferListing[];
    isLoading: boolean;
    cancellingId: string;
    onCancel: (id: string) => void;
}

export function ActiveListings({
    listings,
    isLoading,
    cancellingId,
    onCancel,
}: ActiveListingsProps) {
    return (
        <div className="rounded-[24px] border border-white/10 bg-[#1e1f2e]/80 backdrop-blur-md p-5 pb-6 h-full flex flex-col">
            <h3 className="mb-4 text-base font-bold text-white flex items-center gap-2">
                <div className="h-6 w-1 bg-gradient-to-b from-emerald-500 to-teal-500 rounded-full" />
                Aktif İlanların
            </h3>

            <div className="flex-1 overflow-y-auto min-h-[100px] pr-1 custom-scrollbar">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-32 text-slate-500 gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-sm">İlanlar yükleniyor...</span>
                    </div>
                ) : listings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-slate-500 border border-dashed border-white/10 rounded-xl bg-white/5">
                        <span className="text-sm">Şu anda aktif ilan bulunmamakta.</span>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {listings.map((listing) => {
                            const player = listing.player;
                            const name = player?.name ?? listing.playerName ?? 'Bilinmeyen';
                            const position = player?.position ?? listing.pos ?? 'N/A';

                            return (
                                <div key={listing.id} className="flex items-center justify-between p-3 rounded-xl bg-[#14151f] border border-white/5 hover:border-white/10 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-white/5 text-slate-300 font-bold border border-white/5">
                                            {Math.round(listing.overall ?? 0)}
                                        </div>
                                        <div className="space-y-0.5">
                                            <div className="text-sm font-bold text-slate-200">{name}</div>
                                            <div className="text-xs text-slate-500 flex items-center gap-2">
                                                <span className="text-emerald-400">{formatPrice(listing.price)}</span>
                                                <span className="w-1 h-1 rounded-full bg-slate-700" />
                                                <span>{position}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg"
                                        onClick={() => onCancel(listing.id)}
                                        disabled={cancellingId === listing.id}
                                        title="İlandan Kaldır"
                                    >
                                        {cancellingId === listing.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

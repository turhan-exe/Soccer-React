import { Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';
import { getPositionShortLabel } from '@/lib/positionLabels';
import { TransferListing } from '@/types';

const formatPrice = (value: number, formatter: (value: number) => string) => formatter(value);

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
  const { t, formatCurrency } = useTranslation();

  return (
    <div className="flex h-full flex-col rounded-[24px] border border-white/10 bg-[#1e1f2e]/80 p-5 pb-6 backdrop-blur-md">
      <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-white">
        <div className="h-6 w-1 rounded-full bg-gradient-to-b from-emerald-500 to-teal-500" />
        {t('transfer.activeListings')}
      </h3>

      <div className="custom-scrollbar min-h-[100px] flex-1 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t('transfer.loadingListings')}</span>
          </div>
        ) : listings.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/5 text-slate-500">
            <span className="text-sm">{t('transfer.noActiveListings')}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {listings.map((listing) => {
              const player = listing.player;
              const name = player?.name ?? listing.playerName ?? t('transfer.unknownPlayer');
              const position = getPositionShortLabel(player?.position ?? listing.pos ?? 'N/A');

              return (
                <div key={listing.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-[#14151f] p-3 transition-colors hover:border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/5 bg-white/5 font-bold text-slate-300">
                      {Math.round(listing.overall ?? 0)}
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-sm font-bold text-slate-200">{name}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="text-emerald-400">
                          {formatPrice(listing.price, formatCurrency)}
                        </span>
                        <span className="h-1 w-1 rounded-full bg-slate-700" />
                        <span>{position}</span>
                      </div>
                    </div>
                  </div>

                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-lg text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                    onClick={() => onCancel(listing.id)}
                    disabled={cancellingId === listing.id}
                    title={t('transfer.removeListing')}
                  >
                    {cancellingId === listing.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

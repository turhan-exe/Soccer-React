import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/contexts/LanguageContext';
import { getPositionShortLabel } from '@/lib/positionLabels';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Player } from '@/types';

interface CreateListingProps {
  availablePlayers: Player[];
  selectedPlayerId: string;
  price: string;
  isListing: boolean;
  onSelectPlayer: (id: string) => void;
  onPriceChange: (price: string) => void;
  onSubmit: () => void;
}

export function CreateListing({
  availablePlayers,
  selectedPlayerId,
  price,
  isListing,
  onSelectPlayer,
  onPriceChange,
  onSubmit,
}: CreateListingProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-[24px] border border-white/10 bg-[#1e1f2e]/80 p-5 pb-6 backdrop-blur-md">
      <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-white">
        <div className="h-6 w-1 rounded-full bg-gradient-to-b from-pink-500 to-purple-600" />
        {t('transfer.createListingTitle')}
      </h3>

      <div className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <label className="ml-1 text-xs font-medium text-slate-400">{t('transfer.selectPlayer')}</label>
          <Select value={selectedPlayerId} onValueChange={onSelectPlayer}>
            <SelectTrigger className="h-11 w-full rounded-xl border-white/10 bg-[#14151f] text-slate-200 focus:ring-purple-500/50">
              <SelectValue placeholder={t('transfer.selectPlayerPlaceholder')} />
            </SelectTrigger>
            <SelectContent className="max-h-[240px] border-white/10 bg-[#1e1f2e]">
              {availablePlayers.length === 0 ? (
                <div className="p-3 text-center text-sm text-muted-foreground">
                  {t('transfer.noSellablePlayers')}
                </div>
              ) : (
                availablePlayers.map((player) => (
                  <SelectItem key={player.id} value={player.id} className="cursor-pointer text-slate-200 focus:bg-white/5 focus:text-white">
                    <span className="font-bold">{player.name}</span>{' '}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({getPositionShortLabel(player.position)} - {Math.round(player.overall)})
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="ml-1 text-xs font-medium text-slate-400">{t('transfer.salePrice')}</label>
          <div className="relative">
            <Input
              type="number"
              placeholder={t('transfer.salePricePlaceholder')}
              value={price}
              onChange={(e) => onPriceChange(e.target.value)}
              className="h-11 rounded-xl border-white/10 bg-[#14151f] pr-8 text-white placeholder:text-slate-600"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-slate-500">$</span>
          </div>
        </div>

        <Button
          onClick={onSubmit}
          disabled={!selectedPlayerId || !price || isListing}
          className="mt-2 h-11 w-full rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 font-bold text-white shadow-lg shadow-purple-900/20 transition-all active:scale-[0.98] hover:from-pink-500 hover:to-purple-500"
        >
          {isListing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('transfer.creatingListing')}
            </>
          ) : (
            <>
              {t('transfer.addToMarket')} <span className="ml-1 opacity-80">»</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

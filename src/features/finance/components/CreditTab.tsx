import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Crown, Gift, RefreshCcw, Sparkles } from 'lucide-react';
import type { CreditPackage } from '@/services/finance';
import type { PlayBillingProduct } from '@/services/playBilling';
import { formatCurrency } from './FinanceHeader';

interface CreditTabProps {
  packages: CreditPackage[];
  loadingId: string | null;
  onPurchase: (pack: CreditPackage) => void;
  productsById: Record<string, PlayBillingProduct>;
  isStoreLoading: boolean;
  storeError: string | null;
  vipActive: boolean;
  vipClaimAvailable: boolean;
  vipClaimedToday: boolean;
  vipClaimLoading: boolean;
  vipBonusAmount: number;
  vipBonusDiamondCost: number;
  vipNextClaimDateKey: string;
  onClaimVipBonus: () => void;
}

export function CreditTab({
  packages,
  loadingId,
  onPurchase,
  productsById,
  isStoreLoading,
  storeError,
  vipActive,
  vipClaimAvailable,
  vipClaimedToday,
  vipClaimLoading,
  vipBonusAmount,
  vipBonusDiamondCost,
  vipNextClaimDateKey,
  onClaimVipBonus,
}: CreditTabProps) {
  const vipCostLabel = vipBonusDiamondCost > 0 ? `${vipBonusDiamondCost} Elmas` : 'Ucretsiz';

  return (
    <div className="animate-in slide-in-from-bottom-4 fade-in duration-500">
      <div className="mb-6 rounded-xl border border-white/10 bg-gradient-to-r from-indigo-900/50 to-purple-900/50 p-6 text-center">
        <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
          <Sparkles className="h-6 w-6 text-amber-300" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">Kulup Kredisi Satin Al</h2>
        <p className="mx-auto max-w-md text-sm text-indigo-200">
          Krediler ile kulup butceni aninda artirabilir, transferler ve stadyum harcamalari icin
          ek kaynak yaratabilirsin.
        </p>
      </div>

      {storeError && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {storeError}
        </div>
      )}

      <Card className="mb-6 overflow-hidden border-amber-400/20 bg-gradient-to-br from-amber-500/10 via-slate-900/70 to-emerald-500/10 shadow-xl backdrop-blur-sm">
        <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-200/80">
                VIP Gunluk Bonus
              </p>
              <p className="mt-1 text-2xl font-black tracking-tight text-white">
                {formatCurrency(vipBonusAmount)}
              </p>
              <p className="text-sm text-slate-300">
                Aktif VIP uyeler gunde yalnizca 1 kez bu krediyi alabilir.
              </p>
            </div>
          </div>

          <div className="w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-400">Maliyet</span>
              <span className="font-semibold text-white">{vipCostLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-400">Durum</span>
              <span className={vipActive ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-200'}>
                {vipActive ? (vipClaimedToday ? 'Bugun alindi' : 'Hazir') : 'VIP gerekli'}
              </span>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
              {vipClaimedToday
                ? `Sonraki hak: ${vipNextClaimDateKey}`
                : vipActive
                  ? 'Bu bonus webde ve Androidde ayni server kuralina baglidir.'
                  : 'Bonus sadece aktif VIP uyelere acilir.'}
            </div>
            <Button
              className="w-full bg-amber-500 font-bold text-slate-950 hover:bg-amber-400"
              onClick={onClaimVipBonus}
              disabled={vipClaimLoading || !vipClaimAvailable}
            >
              {vipClaimLoading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
              {!vipActive ? 'VIP Gerekli' : vipClaimedToday ? 'Bugun Alindi' : '+2.000 Kredi Al'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {packages.map((pack) => {
          const storeProduct = productsById[pack.productId];
          const isDisabled = isStoreLoading || !!storeError || !storeProduct;
          const priceLabel = storeProduct?.formattedPrice ?? `$${pack.price.toFixed(2)}`;

          return (
            <Card
              key={pack.id}
              className="group relative overflow-hidden border-white/5 bg-slate-900/60 shadow-xl backdrop-blur-sm transition-colors hover:border-indigo-500/50"
            >
              <div className="absolute right-0 top-0 p-3 opacity-10 transition-opacity group-hover:opacity-100">
                <Sparkles className="h-12 w-12 text-indigo-500" />
              </div>

              <CardContent className="flex h-full flex-col items-center justify-between p-6 text-center">
                <div>
                  <p className="bg-gradient-to-b from-white to-slate-400 bg-clip-text font-mono text-3xl font-black tracking-tighter text-transparent">
                    {formatCurrency(pack.amount)}
                  </p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-widest text-emerald-400">
                    Kredi
                  </p>
                </div>

                <div className="mt-8 w-full space-y-3">
                  <div className="rounded-lg border border-white/5 bg-white/5 py-2 text-lg font-bold text-white">
                    {priceLabel}
                  </div>
                  {!storeProduct && !isStoreLoading && !storeError && (
                    <div className="space-y-1">
                      <div className="text-xs text-amber-300">Play urunu henuz hazir degil.</div>
                      <div className="text-[11px] text-slate-400">Beklenen urun ID: {pack.productId}</div>
                    </div>
                  )}
                  <Button
                    className="w-full bg-indigo-600 font-bold text-white hover:bg-indigo-700"
                    onClick={() => onPurchase(pack)}
                    disabled={loadingId === pack.id || isDisabled}
                  >
                    {loadingId === pack.id && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
                    {isStoreLoading ? 'Yukleniyor' : 'Google Play ile Satin Al'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

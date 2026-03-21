import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCcw, Sparkles } from 'lucide-react';
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
}

export function CreditTab({
  packages,
  loadingId,
  onPurchase,
  productsById,
  isStoreLoading,
  storeError,
}: CreditTabProps) {
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
                    {formatCurrency(pack.amount).replace('$', '')}
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

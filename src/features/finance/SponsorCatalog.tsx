import { Shield, RefreshCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { SponsorCatalogEntry } from '@/services/finance';
import type { PlayBillingProduct } from '@/services/playBilling';
import { buildSponsorStoreProductId } from './sponsorCatalogUtils';
import { formatCurrency } from './components/FinanceHeader';

interface SponsorCatalogProps {
  entries: SponsorCatalogEntry[];
  loading: boolean;
  error: Error | null;
  activeSponsorId: string | null;
  onActivate: (entry: SponsorCatalogEntry) => void;
  loadingId: string | null;
  productsById: Record<string, PlayBillingProduct>;
  isStoreLoading: boolean;
  storeError: string | null;
}

export function SponsorCatalog({
  entries,
  loading,
  error,
  activeSponsorId,
  onActivate,
  loadingId,
  productsById,
  isStoreLoading,
  storeError,
}: SponsorCatalogProps) {
  return (
    <Card className="border-white/5 bg-slate-900/60 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white/90">
          <Shield className="h-4 w-4 text-cyan-300" />
          Sponsor Katalogu
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <RefreshCcw className="h-4 w-4 animate-spin" />
            Sponsorluklar yukleniyor...
          </p>
        )}
        {!loading && error && <p className="text-sm text-rose-300">Katalog okunamadi: {error.message}</p>}
        {storeError && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            {storeError}
          </p>
        )}
        {!loading && !error && entries.length === 0 && <p className="text-sm text-slate-400">Katalog bos.</p>}
        {!loading && !error && entries.map((entry) => {
          const isActive = activeSponsorId === entry.id;
          const sponsorProductId = buildSponsorStoreProductId(entry);
          const storeProduct = sponsorProductId ? productsById[sponsorProductId] ?? null : null;
          const isPremium = entry.type === 'premium';
          const isPurchaseReady = !isPremium || (!!storeProduct && !isStoreLoading && !storeError);
          const priceLabel = isPremium
            ? storeProduct?.formattedPrice ?? formatCurrency(entry.price ?? 0)
            : null;
          return (
            <div key={entry.id} className="rounded-xl border border-white/10 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{entry.name}</p>
                  <p className="text-sm text-slate-400">
                    {entry.reward.cycle === 'daily' ? 'Gunluk' : 'Haftalik'} {formatCurrency(entry.reward.amount)}
                  </p>
                  {isPremium && (
                    <p className="text-xs text-amber-300">Ucret: {priceLabel}</p>
                  )}
                  {isPremium && !storeProduct && !isStoreLoading && !storeError && (
                    <div className="space-y-1">
                      <p className="text-xs text-amber-300">Play urunu henuz hazir degil.</p>
                      {sponsorProductId && (
                        <p className="text-[11px] text-slate-400">Beklenen urun ID: {sponsorProductId}</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={isPremium ? 'text-amber-200' : 'text-emerald-200'}>
                    {entry.type}
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() => onActivate(entry)}
                    disabled={loadingId === entry.id || isActive || !isPurchaseReady}
                  >
                    {loadingId === entry.id && <Shield className="mr-1 h-4 w-4 animate-spin" />}
                    {isActive
                      ? 'Aktif'
                      : isPremium
                        ? isStoreLoading
                          ? 'Yukleniyor'
                          : 'Google Play ile Aktive Et'
                        : 'Aktive Et'}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default SponsorCatalog;

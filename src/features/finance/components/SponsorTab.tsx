import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/contexts/LanguageContext';
import { RefreshCcw, HandCoins } from 'lucide-react';
import {
  getSponsorPayoutAvailability,
  type UserSponsorDoc,
  type SponsorCatalogEntry,
} from '@/services/finance';
import type { PlayBillingProduct } from '@/services/playBilling';
import { formatCurrency } from './FinanceHeader';
import SponsorCatalog from '../SponsorCatalog';

interface SponsorTabProps {
  sponsors: UserSponsorDoc[];
  catalogEntries: SponsorCatalogEntry[];
  catalogLoading: boolean;
  catalogError: Error | null;
  onActivate: (entry: SponsorCatalogEntry) => void;
  onCollect: (id: string) => void;
  loadingId: string | null;
  storeProductsById: Record<string, PlayBillingProduct>;
  isStoreLoading: boolean;
  storeError: string | null;
}

export function SponsorTab({
  sponsors,
  catalogEntries,
  catalogLoading,
  catalogError,
  onActivate,
  onCollect,
  loadingId,
  storeProductsById,
  isStoreLoading,
  storeError,
}: SponsorTabProps) {
  const { t, formatDate } = useTranslation();
  const activeSponsorId = sponsors.find((item) => item.active)?.id ?? null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="animate-in space-y-6 fade-in slide-in-from-bottom-4 duration-500">
      <Card className="border-white/5 bg-slate-900/60 shadow-xl backdrop-blur-sm">
        <CardHeader className="border-b border-white/5 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-white/90">
            <HandCoins className="h-4 w-4 text-emerald-400" />
            {t('finance.sponsors.activeContracts')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4 lg:grid-cols-2">
          {sponsors.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-white/10 bg-white/5 py-8 text-center text-slate-500">
              <p>{t('finance.sponsors.none')}</p>
              <p className="mt-1 text-xs opacity-60">{t('finance.sponsors.noneHelp')}</p>
            </div>
          )}

          {sponsors.map((sponsor) => {
            const payoutAvailability = sponsor.active
              ? getSponsorPayoutAvailability(sponsor, nowMs)
              : null;
            const canCollect = sponsor.active && payoutAvailability?.canCollect === true;
            const nextPayoutLabel =
              sponsor.active && payoutAvailability?.nextPayoutAt
                ? canCollect
                  ? t('finance.sponsors.paymentReady')
                  : t('finance.sponsors.nextPayment', {
                      date: formatDate(payoutAvailability.nextPayoutAt, {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    })
                : null;

            return (
              <div
                key={sponsor.id}
                className={`relative overflow-hidden rounded-xl border p-4 transition-all ${
                  sponsor.active
                    ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-slate-900/50'
                    : 'border-white/10 bg-slate-900/40'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-bold text-white">{sponsor.name}</p>
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase tracking-wider ${
                          sponsor.type === 'premium'
                            ? 'border-amber-500/50 text-amber-400'
                            : 'border-emerald-500/50 text-emerald-400'
                        }`}
                      >
                        {sponsor.type}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-baseline gap-1">
                      <p className="font-mono text-2xl font-bold text-white">
                        {formatCurrency(sponsor.reward.amount)}
                      </p>
                      <p className="text-xs text-slate-400">
                        /{' '}
                        {sponsor.reward.cycle === 'daily'
                          ? t('finance.sponsors.daily')
                          : t('finance.sponsors.weekly')}
                      </p>
                    </div>
                  </div>
                  {sponsor.active && (
                    <Badge className="border-none bg-emerald-500 text-white hover:bg-emerald-600">
                      {t('finance.sponsors.active')}
                    </Badge>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between gap-4 text-xs text-slate-500">
                  <span>
                    {t('finance.sponsors.startedAt', {
                      date: sponsor.activatedAt?.toDate?.()
                        ? formatDate(sponsor.activatedAt.toDate(), {
                            day: '2-digit',
                            month: '2-digit',
                          })
                        : '-',
                    })}
                  </span>
                  {nextPayoutLabel && (
                    <span className={canCollect ? 'text-emerald-300' : 'text-amber-300'}>
                      {nextPayoutLabel}
                    </span>
                  )}
                </div>

                <Button
                  size="sm"
                  className={`mt-4 w-full font-bold tracking-wide ${
                    sponsor.active ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-slate-700'
                  }`}
                  onClick={() => onCollect(sponsor.id)}
                  disabled={loadingId === sponsor.id || !canCollect}
                >
                  {loadingId === sponsor.id && <RefreshCcw className="mr-2 h-3 w-3 animate-spin" />}
                  {!sponsor.active
                    ? t('finance.sponsors.expired')
                    : canCollect
                      ? t('finance.sponsors.collect')
                      : t('finance.sponsors.notReady')}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="border-t border-white/10 pt-4">
        <h3 className="mb-4 px-1 text-sm font-semibold uppercase tracking-wider text-white/70">
          {t('finance.sponsors.catalog')}
        </h3>
        <SponsorCatalog
          entries={catalogEntries}
          loading={catalogLoading}
          error={catalogError}
          activeSponsorId={activeSponsorId}
          onActivate={onActivate}
          loadingId={loadingId}
          productsById={storeProductsById}
          isStoreLoading={isStoreLoading}
          storeError={storeError}
        />
      </div>
    </div>
  );
}

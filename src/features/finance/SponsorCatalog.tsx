import { useCallback } from 'react';
import { Shield, RefreshCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SponsorCatalogEntry, SponsorReward } from '@/services/finance';
import { useCollection } from '@/hooks/useCollection';
import type { QuerySnapshot, DocumentData } from 'firebase/firestore';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(value));

interface SponsorCatalogProps {
  activeSponsorId: string | null;
  onActivate: (entry: SponsorCatalogEntry) => void;
  loadingId: string | null;
}

export function SponsorCatalog({ activeSponsorId, onActivate, loadingId }: SponsorCatalogProps) {
  const mapSnapshot = useCallback(
    (snapshot: QuerySnapshot<DocumentData>): SponsorCatalogEntry[] =>
      snapshot.docs.map((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        const rawReward = raw.reward;
        const rawCycle = raw.cycle;
        const resolveCycle = (): SponsorReward['cycle'] => {
          if (rawCycle === 'daily' || rawCycle === 'weekly') {
            return rawCycle;
          }
          if (typeof rawCycle === 'number') {
            return rawCycle <= 1 ? 'daily' : 'weekly';
          }
          return 'weekly';
        };
        const reward: SponsorReward =
          typeof rawReward === 'number'
            ? { amount: Number(rawReward), cycle: resolveCycle() }
            : typeof rawReward === 'object' && rawReward !== null
              ? {
                amount: Number((rawReward as Record<string, unknown>).amount ?? 0),
                cycle:
                  ((rawReward as Record<string, unknown>).cycle as SponsorReward['cycle']) ?? resolveCycle(),
              }
              : { amount: Number(rawReward ?? 0), cycle: resolveCycle() };
        const normalizedType =
          raw.type === 'premium' || raw.type === 'free'
            ? raw.type
            : typeof raw.price === 'number' && raw.price > 0
              ? 'premium'
              : 'free';
        return {
          id: docSnap.id,
          catalogId: (raw.catalogId as string) ?? docSnap.id,
          name: String(raw.name ?? 'Adsiz Sponsor'),
          type: normalizedType,
          reward,
          price: raw.price === undefined ? undefined : Number(raw.price),
        };
      }),
    [],
  );
  const { data: entries, loading, error } = useCollection<SponsorCatalogEntry>('sponsorship_catalog', mapSnapshot);

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
        {!loading && !error && entries.length === 0 && <p className="text-sm text-slate-400">Katalog bos.</p>}
        {!loading && !error && entries.map((entry) => {
          const isActive = activeSponsorId === entry.id;
          return (
            <div key={entry.id} className="rounded-xl border border-white/10 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{entry.name}</p>
                  <p className="text-sm text-slate-400">
                    {entry.reward.cycle === 'daily' ? 'Gunluk' : 'Haftalik'} {formatCurrency(entry.reward.amount)}
                  </p>
                  {entry.type === 'premium' && (
                    <p className="text-xs text-amber-300">Ucret: {formatCurrency(entry.price ?? 0)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={entry.type === 'premium' ? 'text-amber-200' : 'text-emerald-200'}>
                    {entry.type}
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() => onActivate(entry)}
                    disabled={loadingId === entry.id || isActive}
                  >
                    {loadingId === entry.id && <Shield className="mr-1 h-4 w-4 animate-spin" />}
                    {isActive ? 'Aktif' : 'Aktive Et'}
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

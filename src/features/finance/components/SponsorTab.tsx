import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, Coins, RefreshCcw, HandCoins } from 'lucide-react';
import { UserSponsorDoc, SponsorCatalogEntry } from '@/services/finance';
import { formatCurrency } from './FinanceHeader';
import SponsorCatalog from '../SponsorCatalog';

interface SponsorTabProps {
    sponsors: UserSponsorDoc[];
    onActivate: (entry: SponsorCatalogEntry) => void;
    onCollect: (id: string) => void;
    loadingId: string | null;
}

export function SponsorTab({
    sponsors,
    onActivate,
    onCollect,
    loadingId,
}: SponsorTabProps) {
    const activeSponsorId = sponsors.find((item) => item.active)?.id ?? null;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Card className="border-white/5 bg-slate-900/60 backdrop-blur-sm shadow-xl">
                <CardHeader className="pb-3 border-b border-white/5">
                    <CardTitle className="flex items-center gap-2 text-white/90 text-sm uppercase tracking-wider">
                        <HandCoins className="h-4 w-4 text-emerald-400" />
                        Aktif Sözleşmeler
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 grid gap-4 lg:grid-cols-2">
                    {sponsors.length === 0 && (
                        <div className="col-span-full py-8 text-center text-slate-500 bg-white/5 rounded-xl border border-dashed border-white/10">
                            <p>Henüz aktif bir sponsorluk anlaşmanız bulunmuyor.</p>
                            <p className="text-xs mt-1 opacity-60">Aşağıdaki katalogdan bir sponsor seçin.</p>
                        </div>
                    )}

                    {sponsors.map((sponsor) => (
                        <div key={sponsor.id} className={`relative overflow-hidden rounded-xl border p-4 transition-all ${sponsor.active ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-slate-900/50' : 'border-white/10 bg-slate-900/40'}`}>
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <p className="text-lg font-bold text-white">{sponsor.name}</p>
                                        <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${sponsor.type === 'premium' ? 'border-amber-500/50 text-amber-400' : 'border-emerald-500/50 text-emerald-400'}`}>
                                            {sponsor.type}
                                        </Badge>
                                    </div>
                                    <div className="mt-1 flex items-baseline gap-1">
                                        <p className="text-2xl font-bold font-mono text-white">{formatCurrency(sponsor.reward.amount)}</p>
                                        <p className="text-xs text-slate-400">/ {sponsor.reward.cycle === 'daily' ? 'Günlük' : 'Haftalık'}</p>
                                    </div>
                                </div>
                                {sponsor.active && <Badge className="bg-emerald-500 text-white hover:bg-emerald-600 border-none">AKTİF</Badge>}
                            </div>

                            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                                <span>Başlangıç: {sponsor.activatedAt?.toDate?.().toLocaleDateString?.('tr-TR') ?? '-'}</span>
                            </div>

                            <Button
                                size="sm"
                                className={`mt-4 w-full font-bold tracking-wide ${sponsor.active ? 'bg-emerald-500 hover:bg-emerald-600 text-white' : 'bg-slate-700'}`}
                                onClick={() => onCollect(sponsor.id)}
                                disabled={loadingId === sponsor.id || !sponsor.active}
                            >
                                {loadingId === sponsor.id && <RefreshCcw className="mr-2 h-3 w-3 animate-spin" />}
                                {sponsor.active ? 'Geliri Tahsil Et' : 'Süresi Doldu'}
                            </Button>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <div className="pt-4 border-t border-white/10">
                <h3 className="text-sm font-semibold text-white/70 mb-4 px-1 uppercase tracking-wider">Sponsor Kataloğu</h3>
                {/* We reuse the existing SponsorCatalog but wrapped or styled if needed. 
              Assuming SponsorCatalog handles its own styling, but we might need to pass className or ensure it matches. 
              For now, standard render. */}
                <SponsorCatalog activeSponsorId={activeSponsorId} onActivate={onActivate} loadingId={loadingId} />
            </div>
        </div>
    );
}

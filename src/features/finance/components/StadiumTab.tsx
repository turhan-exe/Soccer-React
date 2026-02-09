import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Building2, RefreshCcw, ChevronsUp, DollarSign, Users } from 'lucide-react';
import { StadiumLevelConfig } from '@/services/finance';
import { formatCurrency } from './FinanceHeader';

interface StadiumTabProps {
    level: number;
    config: StadiumLevelConfig;
    nextConfig: StadiumLevelConfig;
    balance: number;
    upgrading: boolean;
    onUpgrade: () => void;
    hasPermission: boolean | null;
}

export function StadiumTab({
    level,
    config,
    nextConfig,
    balance,
    upgrading,
    onUpgrade,
    hasPermission,
}: StadiumTabProps) {
    const progress = (level / 5) * 100;
    const meetsCost = balance >= nextConfig.upgradeCost;
    const permissionGranted = hasPermission === true;
    const permissionPending = hasPermission === null;
    const canUpgrade = permissionGranted && level < 5 && meetsCost;

    const buttonLabel =
        level >= 5
            ? 'Maksimum Seviye'
            : permissionPending
                ? 'Yetki Aranıyor...'
                : !permissionGranted
                    ? 'Yetki Yok'
                    : meetsCost
                        ? 'Yükselt'
                        : 'Yetersiz Bakiye';

    return (
        <div className="grid gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Card className="border-white/5 bg-slate-900/60 backdrop-blur-sm shadow-xl p-1">
                <div className="relative h-48 w-full overflow-hidden rounded-t-xl bg-slate-950">
                    {/* Placeholder for Stadium Image - could use generated image here later */}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent z-10" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-20">
                        <Building2 className="h-24 w-24 text-white" />
                    </div>
                    <div className="absolute bottom-4 left-4 z-20">
                        <span className="bg-emerald-500 text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded shadow-lg uppercase tracking-wider mb-1 inline-block">Seviye {level}</span>
                        <h2 className="text-2xl font-bold text-white tracking-tight">Stadyum Kompleksi</h2>
                    </div>
                </div>

                <CardContent className="pt-6 space-y-6">
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                            <span>İlerleme</span>
                            <span>%{Math.round(progress)}</span>
                        </div>
                        <Progress value={progress} className="h-2 bg-slate-800" indicatorClassName="bg-gradient-to-r from-emerald-600 to-emerald-400" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <StadiumStat icon={Users} label="Kapasite" value={`${config.capacity.toLocaleString('tr-TR')}`} subValue="Koltuk" tone="blue" />
                        <StadiumStat icon={DollarSign} label="Maç Geliri" value={formatCurrency(config.matchIncome)} subValue="Tahmini" tone="emerald" />
                    </div>

                    {level < 5 && (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
                                        <ChevronsUp className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-white">Sonraki Seviye</p>
                                        <p className="text-xs text-slate-400">Upgrade Maliyeti</p>
                                    </div>
                                </div>
                                <span className={`text-lg font-bold font-mono ${meetsCost ? 'text-white' : 'text-rose-400'}`}>
                                    {formatCurrency(nextConfig.upgradeCost)}
                                </span>
                            </div>

                            <Button
                                className={`w-full font-bold tracking-wide ${canUpgrade ? 'bg-emerald-500 hover:bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                                onClick={onUpgrade}
                                disabled={level >= 5 || upgrading || !canUpgrade}
                                size="lg"
                            >
                                {upgrading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
                                {buttonLabel}
                            </Button>
                        </div>
                    )}

                    {!permissionPending && !permissionGranted && (
                        <p className="text-xs text-center text-rose-400 bg-rose-500/10 p-2 rounded">
                            Bu işlem için takım sahibi yetkisi gerekir.
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function StadiumStat({ icon: Icon, label, value, subValue, tone }: { icon: any, label: string, value: string, subValue: string, tone: 'blue' | 'emerald' }) {
    const colors = tone === 'blue' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    return (
        <div className={`flex flex-col p-4 rounded-xl border ${colors}`}>
            <Icon className="h-4 w-4 mb-2 opacity-80" />
            <span className="text-xs text-slate-400 uppercase tracking-wider">{label}</span>
            <span className="text-xl font-bold text-white tracking-tight">{value}</span>
            <span className="text-[10px] opacity-60">{subValue}</span>
        </div>
    )
}

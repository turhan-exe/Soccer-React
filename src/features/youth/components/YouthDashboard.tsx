import { Button } from '@/components/ui/button';
import { Sparkles, Gem } from 'lucide-react';

interface YouthDashboardProps {
    candidateCount: number;
    averageOverall: number;
    topPotential: number;
    canGenerate: boolean;
    onGenerate: () => void;
    onReset?: () => void;
    nextGenerateTime: string;
    diamondCost?: number;
}

export function YouthDashboard({
    candidateCount,
    averageOverall,
    topPotential,
    canGenerate,
    onGenerate,
    onReset,
    nextGenerateTime,
    diamondCost = 100,
}: YouthDashboardProps) {

    const handleAction = () => {
        if (canGenerate) {
            onGenerate();
        } else if (onReset) {
            onReset();
        }
    };

    return (
        <div className="mb-8">
            <div className="mb-6 px-1">
                <h1 className="text-2xl font-bold text-white mb-2">Altyapı Merkezi</h1>
                <p className="text-slate-400 text-sm">
                    Kadron için umut vadeden bir oyuncu seni bekliyor. En yüksek potansiyel {topPotential > 0 ? topPotential : '81'}.
                </p>
            </div>

            <div className="relative rounded-[32px] overflow-hidden bg-[#1e1f2e] border border-white/5 shadow-2xl">
                {/* Header Strip with Glow */}
                <div className="relative p-6 border-b border-white/5 bg-slate-900/40">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-purple-400">Genel Durum</h2>
                        <div className="bg-slate-900/80 border border-white/10 rounded-full px-3 py-1 text-xs text-white font-mono">
                            Bakiye: $103.56
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Şuanda aktif ilan bulunmamakta.</p>
                </div>

                {/* Stats Content */}
                <div className="p-8">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Aday Havuzu</p>
                            <p className="text-xl font-bold text-white mb-0.5">{candidateCount} Aday</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Ortalama Genel</p>
                            <p className="text-xl font-bold text-white mb-0.5">{averageOverall > 0 ? averageOverall : '80.65'} Ortalama</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Yüksek Potansiyel</p>
                            <p className="text-xl font-bold text-white mb-0.5">{topPotential > 0 ? topPotential : '5'} Potansiyel</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 font-medium mb-1">Yeni Üretim</p>
                            <p className="text-xl font-bold text-emerald-400 mb-0.5 font-mono">{nextGenerateTime}</p>
                        </div>
                    </div>

                    <div className="flex justify-center">
                        <Button
                            onClick={handleAction}
                            className="relative px-12 py-6 rounded-full bg-slate-900 border border-white/10 hover:bg-slate-800 transition-all group overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-cyan-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="absolute inset-0 rounded-full border border-white/10" />
                            <span className="relative z-10 text-white font-semibold text-lg flex items-center gap-2">
                                {!canGenerate && onReset ? (
                                    <>
                                        Yetenek Ara
                                        <div className="flex items-center gap-1 bg-emerald-500/20 px-2 py-0.5 rounded text-emerald-400 text-sm ml-2">
                                            <Gem className="w-3 h-3 fill-current" />
                                            {diamondCost}
                                        </div>
                                    </>
                                ) : (
                                    "Yetenek Ara"
                                )}
                            </span>
                            {/* Inner Glow Border Effect for Button */}
                            <div className="absolute inset-0 rounded-full border-2 border-transparent group-hover:border-purple-500/30 transition-colors" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

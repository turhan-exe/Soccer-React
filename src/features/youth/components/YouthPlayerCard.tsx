import { Button } from '@/components/ui/button';
import { YouthCandidate } from '@/services/youth';
import { Badge } from '@/components/ui/badge';

interface YouthPlayerCardProps {
    candidate: YouthCandidate;
    onAccept: (id: string) => void;
    onRelease: (id: string) => void;
    onViewDetails: (candidate: YouthCandidate) => void;
}

export function YouthPlayerCard({
    candidate,
    onAccept,
    onRelease,
    onViewDetails,
}: YouthPlayerCardProps) {
    const { player } = candidate;

    // Normalize overall for display (0-100)
    const displayOverall = player.overall <= 1 ? Math.round(player.overall * 100) : Math.round(player.overall);

    return (
        <div className="relative w-full max-w-md rounded-[24px] bg-[#1a1b2e] border border-white/5 p-6 overflow-hidden hover:border-white/10 transition-colors">
            <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                    {/* Logo Placeholder */}
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-900 to-indigo-900 flex items-center justify-center border border-white/10 shadow-lg shadow-purple-900/20">
                        <span className="text-xl font-bold text-white">{player.name.charAt(0)}</span>
                    </div>

                    <div>
                        <h3 className="text-lg font-bold text-white leading-tight">{player.name}</h3>
                        <div className="flex items-center gap-3 mt-1 text-slate-400 text-sm">
                            <span>{player.age} Yaş</span>
                            <span className="w-1 h-1 rounded-full bg-slate-600" />
                            <span className="text-emerald-400 font-bold">{displayOverall} Güç</span>
                        </div>
                    </div>
                </div>

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewDetails(candidate)}
                    className="h-8 rounded-full border border-white/10 bg-white/5 text-purple-300 hover:bg-white/10 hover:text-white text-xs px-4"
                >
                    Oyuncu Detayları
                </Button>
            </div>

            <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Form</span>
                    <span className="text-slate-300">İyi</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Potansiyel</span>
                    <span className="text-indigo-400 font-bold">{Math.round((player.potential ?? player.overall) * 100)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Genel Performans</span>
                    <div className="h-1.5 w-24 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full w-[70%] bg-purple-500 rounded-full" />
                    </div>
                </div>
            </div>


            <div className="flex items-center gap-4">
                <button
                    onClick={() => onAccept(candidate.id)}
                    className="text-emerald-400 hover:text-emerald-300 text-sm font-semibold transition-colors"
                >
                    Takıma Al
                </button>
                <button
                    onClick={() => onRelease(candidate.id)}
                    className="text-rose-400 hover:text-rose-300 text-sm font-semibold transition-colors"
                >
                    Serbest Bırak
                </button>
            </div>

            {/* Decorative Blur */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 blur-[60px] pointer-events-none" />
        </div >
    );
}


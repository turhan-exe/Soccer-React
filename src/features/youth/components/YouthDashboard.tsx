import { Button } from '@/components/ui/button';
import { Gem } from 'lucide-react';

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
        <h1 className="mb-2 text-2xl font-bold text-white">Altyapı Merkezi</h1>
        <p className="text-sm text-slate-400">
          Kadron için umut vadeden bir oyuncu seni bekliyor. En yüksek potansiyel{' '}
          {topPotential > 0 ? topPotential : '81'}.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-[32px] border border-white/5 bg-[#1e1f2e] shadow-2xl">
        <div className="relative border-b border-white/5 bg-slate-900/40 p-6">
          <div className="absolute left-0 top-0 h-[1px] w-full bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-purple-400">Genel Durum</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">Şu anda aktif ilan bulunmamakta.</p>
        </div>

        <div className="p-8">
          <div className="mb-8 grid grid-cols-2 gap-8 lg:grid-cols-4">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Aday Havuzu</p>
              <p className="mb-0.5 text-xl font-bold text-white">{candidateCount} Aday</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Ortalama Genel</p>
              <p className="mb-0.5 text-xl font-bold text-white">
                {averageOverall > 0 ? averageOverall : '80.65'} Ortalama
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Yüksek Potansiyel</p>
              <p className="mb-0.5 text-xl font-bold text-white">
                {topPotential > 0 ? topPotential : '5'} Potansiyel
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Yeni Üretim</p>
              <p className="mb-0.5 font-mono text-xl font-bold text-emerald-400">
                {nextGenerateTime}
              </p>
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              onClick={handleAction}
              className="group relative overflow-hidden rounded-full border border-white/10 bg-slate-900 px-12 py-6 transition-all hover:bg-slate-800"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-cyan-500/20 opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="absolute inset-0 rounded-full border border-white/10" />
              <span className="relative z-10 flex items-center gap-2 text-lg font-semibold text-white">
                {!canGenerate && onReset ? (
                  <>
                    Yetenek Ara
                    <div className="ml-2 flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-sm text-emerald-400">
                      <Gem className="h-3 w-3 fill-current" />
                      {diamondCost}
                    </div>
                  </>
                ) : (
                  'Yetenek Ara'
                )}
              </span>
              <div className="absolute inset-0 rounded-full border-2 border-transparent transition-colors group-hover:border-purple-500/30" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

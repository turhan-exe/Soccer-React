import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  YOUTH_AD_REDUCTION_MS,
  YOUTH_RESET_DIAMOND_COST,
} from '@/services/youth';

interface Props {
  nextGenerateAt: Date | null;
  onReset: () => void;
  canReset: boolean;
  onWatchAd: () => void;
  canWatchAd: boolean;
  cooldownDurationMs: number;
  className?: string;
}

const CooldownPanel: React.FC<Props> = ({
  nextGenerateAt,
  onReset,
  canReset,
  onWatchAd,
  canWatchAd,
  cooldownDurationMs,
  className,
}) => {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const tick = () => {
      if (!nextGenerateAt) {
        setRemaining(0);
        return;
      }
      const diff = nextGenerateAt.getTime() - Date.now();
      setRemaining(diff > 0 ? diff : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextGenerateAt]);

  const baseDuration = Math.max(1, cooldownDurationMs);
  const progress = baseDuration
    ? ((baseDuration - remaining) / baseDuration) * 100
    : 100;

  const hours = Math.floor(remaining / 3600000).toString().padStart(2, '0');
  const minutes = Math.floor((remaining % 3600000) / 60000)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor((remaining % 60000) / 1000)
    .toString()
    .padStart(2, '0');

  const canGenerate = remaining === 0;

  return (
    <Card
      className={cn(
        'border-white/10 bg-slate-900/80 text-slate-100 shadow-xl backdrop-blur',
        className,
      )}
    >
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold text-white">Oyuncu Üretimi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-slate-200">
        <Progress value={progress} className="h-2 bg-white/10" />
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <span className="font-medium text-white">
              Sonraki üretim: {hours}:{minutes}:{seconds}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                onClick={onWatchAd}
                disabled={!canWatchAd}
                size="sm"
                variant="outline"
                data-testid="youth-watch-ad"
                className="border-white/20 bg-transparent text-cyan-100 hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-white"
              >
                Reklam İzle (-12 saat)
              </Button>
              <Button
                onClick={onReset}
                disabled={!canReset || canGenerate}
                size="sm"
                variant="secondary"
                data-testid="youth-reset"
                className="border border-transparent bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-cyan-400"
              >
                Hemen Al (💎{YOUTH_RESET_DIAMOND_COST})
              </Button>
            </div>
          </div>
          <p className="leading-relaxed text-slate-300">
            Altyapı oyuncuları haftada bir gelir. Reklam izleyerek bekleme süresini{' '}
            {(YOUTH_AD_REDUCTION_MS / 3600000).toFixed(0)} saat kısaltabilir veya elmas
            kullanarak hemen yeni oyuncu alabilirsin.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default CooldownPanel;


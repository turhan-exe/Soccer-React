import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  YOUTH_AD_REDUCTION_MS,
  YOUTH_COOLDOWN_MS,
  YOUTH_RESET_DIAMOND_COST,
} from '@/services/youth';

interface Props {
  nextGenerateAt: Date | null;
  onReset: () => void;
  canReset: boolean;
  onWatchAd: () => void;
  canWatchAd: boolean;
}

const CooldownPanel: React.FC<Props> = ({
  nextGenerateAt,
  onReset,
  canReset,
  onWatchAd,
  canWatchAd,
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

  const progress = YOUTH_COOLDOWN_MS
    ? ((YOUTH_COOLDOWN_MS - remaining) / YOUTH_COOLDOWN_MS) * 100
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
    <Card>
      <CardHeader>
        <CardTitle>Oyuncu Üretimi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Progress value={progress} className="h-2" />
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span>
              Sonraki üretim: {hours}:{minutes}:{seconds}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                onClick={onWatchAd}
                disabled={!canWatchAd}
                size="sm"
                variant="outline"
                data-testid="youth-watch-ad"
              >
                Reklam İzle (-12 saat)
              </Button>
              <Button
                onClick={onReset}
                disabled={!canReset || canGenerate}
                size="sm"
                variant="secondary"
                data-testid="youth-reset"
              >
                Hemen Al (💎{YOUTH_RESET_DIAMOND_COST})
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground">
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


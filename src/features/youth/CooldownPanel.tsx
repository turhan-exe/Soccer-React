import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { YOUTH_COOLDOWN_MS } from '@/services/youth';

interface Props {
  nextGenerateAt: Date | null;
  onReset: () => void;
  canReset: boolean;
}

const CooldownPanel: React.FC<Props> = ({ nextGenerateAt, onReset, canReset }) => {
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
        <div className="flex items-center justify-between text-sm">
          <span>
            Sonraki üretim: {hours}:{minutes}:{seconds}
          </span>
          <Button
            onClick={onReset}
            disabled={!canReset || canGenerate}
            size="sm"
            variant="secondary"
            data-testid="youth-reset"
          >
            Hızlandır (💎5)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default CooldownPanel;


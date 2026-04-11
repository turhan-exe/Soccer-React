import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useTranslation } from '@/contexts/LanguageContext';
import { ACADEMY_COOLDOWN_MS, ACADEMY_RESET_DIAMOND_COST } from '@/services/academy';

interface Props {
  nextPullAt: Date | null;
  onReset: () => void;
  canReset: boolean;
}

const CooldownPanel: React.FC<Props> = ({ nextPullAt, onReset, canReset }) => {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const tick = () => {
      if (!nextPullAt) {
        setRemaining(0);
        return;
      }
      const diff = nextPullAt.getTime() - Date.now();
      setRemaining(diff > 0 ? diff : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextPullAt]);

  const progress = ACADEMY_COOLDOWN_MS
    ? ((ACADEMY_COOLDOWN_MS - remaining) / ACADEMY_COOLDOWN_MS) * 100
    : 100;

  const hours = Math.floor(remaining / 3600000).toString().padStart(2, '0');
  const minutes = Math.floor((remaining % 3600000) / 60000)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor((remaining % 60000) / 1000)
    .toString()
    .padStart(2, '0');

  const canPull = remaining === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('academy.generation.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Progress value={progress} className="h-2" />
        <div className="flex items-center justify-between text-sm">
          <span>{t('academy.generation.next', { time: `${hours}:${minutes}:${seconds}` })}</span>
          <Button
            onClick={onReset}
            disabled={!canReset || canPull}
            size="sm"
            variant="secondary"
            data-testid="academy-reset"
          >
            {t('academy.generation.speedUp', { cost: ACADEMY_RESET_DIAMOND_COST })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default CooldownPanel;

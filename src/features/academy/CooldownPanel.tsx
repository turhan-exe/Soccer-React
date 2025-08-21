import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  nextPullAt: Date | null;
  onPull: () => void;
  onReset: () => void;
  canReset: boolean;
}

const CooldownPanel: React.FC<Props> = ({ nextPullAt, onPull, onReset, canReset }) => {
  const [remaining, setRemaining] = useState(0);
       console.log("login ok: CooldownPanel v2 RENDER", { nextPullAt, remaining });

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

  const canPull = remaining === 0;
  const hours = Math.floor(remaining / 3600000)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((remaining % 3600000) / 60000)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor((remaining % 60000) / 1000)
    .toString()
    .padStart(2, '0');

  return (
    <div className="flex items-center gap-2">
      <Button onClick={onPull} disabled={!canPull} data-testid="academy-pull">
        Aday Çek
      </Button>
      <Button
        onClick={onReset}
        disabled={!canReset || canPull}
        variant="secondary"
        data-testid="academy-reset"
      >
        Süreyi Sıfırla (100💎)
      </Button>
      {!canPull && (
        <span className="text-sm text-muted-foreground">
          Kalan: {hours}:{minutes}:{seconds}
        </span>
      )}
    </div>
  );
};

export default CooldownPanel;

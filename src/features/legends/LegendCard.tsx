import { useEffect, useMemo, useState } from 'react';
import type { LegendPlayer } from './players';
import { Button } from '@/components/ui/button';
import './legend-card.css';

const RARITY_LABELS: Record<LegendPlayer['rarity'], string> = {
  legend: 'Efsane',
  rare: 'Nadir',
  common: 'Klasik',
};

interface Props {
  player: LegendPlayer;
  onRent?: (p: LegendPlayer) => void;
  onRelease?: (p: LegendPlayer) => void;
}

export default function LegendCard({ player, onRent, onRelease }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShow(true), 50);
    return () => clearTimeout(id);
  }, [player]);

  const rarityLabel = RARITY_LABELS[player.rarity];
  const backgroundImage = useMemo(
    () => `url("${encodeURI(player.image)}")`,
    [player.image],
  );

  return (
    <div className="legend-card-wrapper">
      <div className={`legend-card ${show ? 'show' : 'reveal'} ${player.rarity}`}>
        <div
          className="legend-card-bg"
          style={{ backgroundImage }}
          aria-hidden
        />
        <div className="legend-card-content">
          <div className="legend-card-meta">
            <span className="legend-card-tag">Güç {player.rating}</span>
            <span className={`legend-card-rarity ${player.rarity}`}>{rarityLabel}</span>
          </div>
          <div className="legend-card-actions">
            {onRent && (
              <Button size="sm" onClick={() => onRent(player)}>
                Oyuncuyu kirala
              </Button>
            )}
            {onRelease && (
              <Button size="sm" variant="secondary" onClick={() => onRelease(player)}>
                Serbest bırak
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

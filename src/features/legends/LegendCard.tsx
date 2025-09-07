import { useEffect, useState } from 'react';
import type { LegendPlayer } from './players';
import { Button } from '@/components/ui/button';
import './legend-card.css';

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

  return (
    <div className="legend-card-wrapper">
      <div className={`legend-card ${show ? 'show' : 'reveal'} ${player.rarity}`}>
        <div className="flex flex-col items-center gap-2">
          <img
            src={player.image}
            alt={player.name}
            className="w-16 h-16 rounded-full object-cover"
          />
          <h3 className="flex items-center gap-2">{player.name}</h3>
        </div>
        <p>Güç: {player.rating}</p>
        <div className="mt-4 flex justify-center gap-2">
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
  );
}

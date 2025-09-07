import { useEffect, useState } from 'react';
import type { LegendPlayer } from './players';
import './legend-card.css';

interface Props {
  player: LegendPlayer;
}

export default function LegendCard({ player }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShow(true), 50);
    return () => clearTimeout(id);
  }, [player]);

  return (
    <div className="legend-card-wrapper">
      <div className={`legend-card ${show ? 'show' : 'reveal'} ${player.rarity}`}>
        <h3>{player.name}</h3>
        <p>Güç: {player.rating}</p>
      </div>
    </div>
  );
}

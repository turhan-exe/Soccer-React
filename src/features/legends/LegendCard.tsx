import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';
import { getPositionLabel, getPositionShortLabel } from '@/lib/positionLabels';

import type { LegendPlayer } from './players';
import './legend-card.css';

interface Props {
  player: LegendPlayer;
  onRent?: (p: LegendPlayer) => void;
  onRelease?: (p: LegendPlayer) => void;
}

export default function LegendCard({ player, onRent, onRelease }: Props) {
  const { language, t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShow(true), 50);
    return () => clearTimeout(id);
  }, [player]);

  const rarityLabel = t(`legends.rarity.${player.rarity}`);
  const backgroundImage = useMemo(
    () => `url("${encodeURI(player.image)}")`,
    [player.image],
  );
  const positionLabel = getPositionLabel(player.position, language);
  const positionShortLabel = getPositionShortLabel(player.position, language);

  return (
    <div className="legend-card-wrapper">
      <div className={`legend-card ${show ? 'show' : 'reveal'} ${player.rarity}`}>
        <div className="legend-card-bg" style={{ backgroundImage }} aria-hidden />
        <div className="legend-card-content">
          <div className="legend-card-meta">
            <span className="legend-card-tag">
              {t('legends.card.power', { value: player.rating })}
            </span>
            <span className={`legend-card-rarity ${player.rarity}`}>{rarityLabel}</span>
          </div>
          <div className="legend-card-bottom">
            <span className="legend-card-role">
              {positionShortLabel} - {positionLabel}
            </span>
            <div className="legend-card-actions">
              {onRent && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="legend-card-accept"
                  onClick={() => onRent(player)}
                >
                  {t('legends.card.accept')}
                </Button>
              )}
              {onRelease && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="legend-card-release"
                  onClick={() => onRelease(player)}
                >
                  {t('legends.card.release')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

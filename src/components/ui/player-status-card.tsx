import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  PerformanceGauge,
  clampPerformanceGauge,
} from '@/components/ui/performance-gauge';
import { StatBar } from '@/components/ui/stat-bar';
import { useTranslation } from '@/contexts/LanguageContext';
import { calculatePowerIndex, formatRatingLabel, normalizeRatingTo100 } from '@/lib/player';
import { getPositionLabel, getPositionShortLabel } from '@/lib/positionLabels';
import { getTrainingAttributeLabel } from '@/lib/trainingLabels';
import { cn } from '@/lib/utils';
import { Player } from '@/types';

interface PlayerStatusCardProps {
  player: Player;
  className?: string;
}

const ATTRIBUTE_KEYS: Array<keyof Player['attributes']> = [
  'strength',
  'acceleration',
  'topSpeed',
  'dribbleSpeed',
  'jump',
  'tackling',
  'ballKeeping',
  'passing',
  'longBall',
  'agility',
  'shooting',
  'shootPower',
  'positioning',
  'reaction',
  'ballControl',
];

const playerInitials = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

export function PlayerStatusCard({ player, className }: PlayerStatusCardProps) {
  const { language, t } = useTranslation();
  const health = clampPerformanceGauge(player.health, 1);
  const condition = clampPerformanceGauge(player.condition);
  const motivation = clampPerformanceGauge(player.motivation);

  const power = useMemo(
    () =>
      calculatePowerIndex({
        ...player,
        condition,
        motivation,
      }),
    [player, condition, motivation],
  );

  return (
    <div
      className={cn(
        'w-80 rounded-xl border border-emerald-100 bg-white p-4 shadow-lg shadow-emerald-100/40 dark:border-emerald-900/60 dark:bg-slate-900',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('common.playerStatusCard.title')}
          </p>
          <h3 className="truncate text-base font-semibold">{player.name}</h3>
          <p className="text-xs text-muted-foreground">
            {t('common.playerStatusCard.summary', {
              position: getPositionLabel(player.position, language),
              power: normalizeRatingTo100(power),
              overall: formatRatingLabel(player.overall),
            })}
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="secondary" className="text-[11px]">
              {t('common.ageShort', { age: player.age })}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {t('common.playerStatusCard.potential', {
                value: formatRatingLabel(player.potential),
              })}
            </Badge>
            {player.injuryStatus === 'injured' && (
              <Badge variant="destructive" className="text-[11px]">
                {t('common.injury.injured')}
              </Badge>
            )}
            {player.roles?.map((role) => (
              <Badge key={role} variant="outline" className="text-[11px]">
                {getPositionShortLabel(role, language)}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 text-sm font-semibold text-emerald-700 dark:from-emerald-700/60 dark:to-emerald-800/80 dark:text-emerald-50">
          {playerInitials(player.name)}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <PerformanceGauge label={t('common.playerStatusCard.metrics.power')} value={power} />
        <PerformanceGauge label={t('common.playerStatusCard.metrics.health')} value={health} />
        <PerformanceGauge
          label={t('common.playerStatusCard.metrics.condition')}
          value={condition}
        />
        <PerformanceGauge
          label={t('common.playerStatusCard.metrics.motivation')}
          value={motivation}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {ATTRIBUTE_KEYS.map((key) => (
          <StatBar
            key={key}
            label={getTrainingAttributeLabel(key)}
            value={player.attributes[key]}
            condensed
          />
        ))}
      </div>
    </div>
  );
}

export default PlayerStatusCard;

import { useMemo } from 'react';
import { Player } from '@/types';
import { Badge } from '@/components/ui/badge';
import { PerformanceGauge, clampPerformanceGauge } from '@/components/ui/performance-gauge';
import { StatBar } from '@/components/ui/stat-bar';
import { calculatePowerIndex } from '@/lib/player';
import { cn } from '@/lib/utils';

interface PlayerStatusCardProps {
  player: Player;
  className?: string;
}

const ATTRIBUTE_LABELS: { key: keyof Player['attributes']; label: string }[] = [
  { key: 'strength', label: 'Güç' },
  { key: 'acceleration', label: 'Hızlanma' },
  { key: 'topSpeed', label: 'Maks Hız' },
  { key: 'dribbleSpeed', label: 'Dribling Hızı' },
  { key: 'jump', label: 'Sıçrama' },
  { key: 'tackling', label: 'Mücadele' },
  { key: 'ballKeeping', label: 'Top Saklama' },
  { key: 'passing', label: 'Pas' },
  { key: 'longBall', label: 'Uzun Top' },
  { key: 'agility', label: 'Çeviklik' },
  { key: 'shooting', label: 'Şut' },
  { key: 'shootPower', label: 'Şut Gücü' },
  { key: 'positioning', label: 'Pozisyon Alma' },
  { key: 'reaction', label: 'Refleks' },
  { key: 'ballControl', label: 'Top Kontrolü' },
];

const playerInitials = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');

export function PlayerStatusCard({ player, className }: PlayerStatusCardProps) {
  const condition = clampPerformanceGauge(player.condition);
  const motivation = clampPerformanceGauge(player.motivation);

  const power = useMemo(
    () =>
      calculatePowerIndex({
        ...player,
        condition,
        motivation,
      }),
    [player, condition, motivation]
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
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Oyuncu Statüleri</p>
          <h3 className="truncate text-base font-semibold">{player.name}</h3>
          <p className="text-xs text-muted-foreground">
            {player.position} • Güç {Math.round(power * 100)} • Genel {Math.round(player.overall * 100)}
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="secondary" className="text-[11px]">
              {player.age} yaş
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              Potansiyel {Math.round(player.potential * 100)}
            </Badge>
            {player.injuryStatus === 'injured' && (
              <Badge variant="destructive" className="text-[11px]">
                Sakat
              </Badge>
            )}
            {player.roles?.map(role => (
              <Badge key={role} variant="outline" className="text-[11px]">
                {role}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 text-sm font-semibold text-emerald-700 dark:from-emerald-700/60 dark:to-emerald-800/80 dark:text-emerald-50">
          {playerInitials(player.name)}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <PerformanceGauge label="Güç" value={power} />
        <PerformanceGauge label="Kondisyon" value={condition} />
        <PerformanceGauge label="Motivasyon" value={motivation} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {ATTRIBUTE_LABELS.map(({ key, label }) => (
          <StatBar key={key} label={label} value={player.attributes[key]} condensed />
        ))}
      </div>
    </div>
  );
}

export default PlayerStatusCard;

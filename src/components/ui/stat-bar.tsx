import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface StatBarProps {
  label: string;
  value: number;
  max?: number;
  className?: string;
  condensed?: boolean;
}

const normalizeKey = (label: string): string =>
  label
    .normalize('NFD')
    .replace(/[^\w\s]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');

const STAT_COLOR_MAP: Record<string, string> = {
  strength: 'bg-amber-500',
  güç: 'bg-amber-500',
  guc: 'bg-amber-500',
  shootpower: 'bg-orange-500',
  şutgücü: 'bg-orange-500',
  shooting: 'bg-orange-500',
  şut: 'bg-orange-500',
  acceleration: 'bg-sky-500',
  hızlanma: 'bg-sky-500',
  topspeed: 'bg-sky-500',
  makshız: 'bg-sky-500',
  dribblespeed: 'bg-sky-500',
  driblinghızı: 'bg-sky-500',
  agility: 'bg-teal-500',
  çeviklik: 'bg-teal-500',
  jump: 'bg-lime-500',
  sıçrama: 'bg-lime-500',
  tackling: 'bg-emerald-500',
  mücadele: 'bg-emerald-500',
  ballkeeping: 'bg-cyan-500',
  topsaklama: 'bg-cyan-500',
  passing: 'bg-blue-500',
  pas: 'bg-blue-500',
  longball: 'bg-indigo-500',
  uzuntop: 'bg-indigo-500',
  positioning: 'bg-purple-500',
  pozisyonalma: 'bg-purple-500',
  reaction: 'bg-pink-500',
  refleks: 'bg-pink-500',
  ballcontrol: 'bg-rose-500',
  topkontrolü: 'bg-rose-500',
};

const TRACK_CLASS = 'bg-slate-200/80 dark:bg-slate-700/70';

export const StatBar: React.FC<StatBarProps> = ({
  label,
  value,
  max = 1,
  className = '',
  condensed = false,
}) => {
  const percentage = Math.min((value / max) * 100, 100);
  const key = normalizeKey(label);
  const indicatorClass = STAT_COLOR_MAP[key] ?? 'bg-slate-500';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('space-y-1', className)} data-condensed={condensed}>
          <div className={cn('flex items-center justify-between text-xs', condensed && 'text-[11px]')}>
            <span className="text-muted-foreground font-medium">{label}</span>
            <span className="text-foreground font-semibold">{percentage.toFixed(0)}</span>
          </div>
          <Progress
            value={percentage}
            className={cn(condensed ? 'h-1.5' : 'h-2', TRACK_CLASS)}
            indicatorClassName={indicatorClass}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>Maks: {Math.round(max * 100)}</TooltipContent>
    </Tooltip>
  );
};

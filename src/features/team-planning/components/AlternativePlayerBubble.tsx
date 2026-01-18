import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatRatingLabel } from '@/lib/player';
import { DisplayPlayer, getPlayerPower, getPositionLabel } from '../teamPlanningUtils';

const STRENGTH_DIFF_EPSILON = 0.1;

type AlternativePlayerBubbleProps = {
  player: DisplayPlayer;
  onSelect: (playerId: string) => void;
  variant?: 'pitch' | 'panel';
  compareToPlayer?: DisplayPlayer | null;
};

export const AlternativePlayerBubble: React.FC<AlternativePlayerBubbleProps> = ({
  player,
  onSelect,
  variant = 'pitch',
  compareToPlayer,
}) => {
  const badgeLabel =
    player.squadRole === 'bench'
      ? 'YDK'
      : player.squadRole === 'reserve'
        ? 'RZV'
        : 'KDR';
  const badgeTitle =
    player.squadRole === 'bench'
      ? 'Yedek'
      : player.squadRole === 'reserve'
        ? 'Rezerv'
        : 'Kadro Dışı';

  const comparisonPower = compareToPlayer ? getPlayerPower(compareToPlayer) : null;
  const playerPower = getPlayerPower(player);
  const powerDiff = comparisonPower === null ? 0 : playerPower - comparisonPower;
  const showStrengthIndicator =
    comparisonPower !== null && Math.abs(powerDiff) > STRENGTH_DIFF_EPSILON;
  const isStronger = showStrengthIndicator && powerDiff > 0;
  const positionLabel = getPositionLabel(player.position);

  const rootClasses = cn(
    'tp-alternative-card group relative flex w-full items-start gap-3 rounded-2xl border px-3 py-2 text-left text-[11px] font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:px-[0.875rem] sm:py-[0.625rem]',
    variant === 'panel'
      ? 'tp-alternative-card--panel border-white/20 bg-white/10 text-white hover:border-white/50 hover:bg-white/15'
      : 'border-white/25 bg-white/5 text-white/95 hover:border-white/50 hover:bg-white/10 backdrop-blur-sm',
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={() => onSelect(player.id)} className={rootClasses}>
          <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-emerald-300/90 to-emerald-500 px-2 text-emerald-950 shadow-sm">
            <span className="line-clamp-2 w-full break-normal text-center text-[9.5px] font-semibold leading-tight">
              {player.name}
            </span>
            <span className="absolute bottom-0 right-0 rounded-tl-lg bg-emerald-900/90 px-1 text-[8.5px] font-semibold uppercase text-emerald-100 shadow-lg">
              {badgeLabel}
            </span>
          </div>

          <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5 py-0.5">
            <span className="text-[10.5px] font-bold tracking-wide text-white/90 truncate pr-2">
              {positionLabel}
            </span>
            <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-white/60">
              <span>{player.age} yaş</span>
              <span className="text-white/30">•</span>
              <span className="font-medium text-emerald-100">GEN {formatRatingLabel(player.overall)}</span>

              {player.originalOverall > player.assignedOverall && (
                <>
                  <span className="text-white/30">•</span>
                  <span className="uppercase tracking-wide text-emerald-200/70">
                    ({formatRatingLabel(player.originalOverall)})
                  </span>
                </>
              )}

              {showStrengthIndicator && (
                <span
                  className={cn(
                    'ml-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-tight shadow-sm',
                    isStronger
                      ? 'bg-emerald-400/20 text-emerald-300'
                      : 'bg-rose-400/20 text-rose-300',
                  )}
                >
                  {isStronger ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
                  {Math.abs(powerDiff).toFixed(1)}
                </span>
              )}
            </div>
          </div>

          <div className="hidden shrink-0 flex-col items-end text-[10px] font-medium text-white/50 xl:flex">
            <span className="uppercase tracking-wide text-[9px]">{badgeTitle}</span>
            <span className="text-white/30 font-mono text-[9px]">
              #{player.squadRole === 'bench' ? '02' : player.squadRole === 'reserve' ? '03' : '04'}
            </span>
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent className="z-50 space-y-1">
        <div className="text-xs font-semibold">{player.name}</div>
        <div className="text-[11px] text-muted-foreground">{badgeTitle}</div>
      </TooltipContent>
    </Tooltip>
  );
};

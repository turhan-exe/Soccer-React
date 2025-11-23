import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatRatingLabel } from '@/lib/player';
import {
  canonicalPosition,
  DisplayPlayer,
  getPlayerPower,
} from '../teamPlanningUtils';

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
        : 'Kadrod��Y��';

  const comparisonPower = compareToPlayer ? getPlayerPower(compareToPlayer) : null;
  const playerPower = getPlayerPower(player);
  const powerDiff = comparisonPower === null ? 0 : playerPower - comparisonPower;
  const showStrengthIndicator =
    comparisonPower !== null && Math.abs(powerDiff) > STRENGTH_DIFF_EPSILON;
  const isStronger = showStrengthIndicator && powerDiff > 0;
  const positionLabel = canonicalPosition(player.position);

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

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-white/70">
              <span className="font-semibold uppercase tracking-wide text-white/80">{positionLabel}</span>
              <span>{player.age} ya�Y</span>
              <span className="font-semibold text-white/80">GEN {formatRatingLabel(player.overall)}</span>
              {player.originalOverall > player.assignedOverall ? (
                <span className="text-[10px] uppercase tracking-wide text-emerald-200">
                  Orj: {formatRatingLabel(player.originalOverall)}
                </span>
              ) : null}
              {showStrengthIndicator ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tight shadow-sm',
                    isStronger
                      ? 'bg-emerald-400/90 text-emerald-950'
                      : 'bg-rose-400/90 text-rose-950',
                  )}
                >
                  {isStronger ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  {Math.abs(powerDiff).toFixed(1)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="hidden flex-col items-end text-[10px] font-semibold text-white/60 sm:flex">
            <span className="uppercase tracking-wide">{badgeTitle}</span>
            <span className="text-white/40">
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

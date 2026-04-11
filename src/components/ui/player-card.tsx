import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { MoreVertical, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PerformanceGauge,
  clampPerformanceGauge,
} from '@/components/ui/performance-gauge';
import { StatBar } from '@/components/ui/stat-bar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/contexts/LanguageContext';
import { formatContractCountdown } from '@/lib/contracts';
import { calculatePowerIndex, formatRatingLabel } from '@/lib/player';
import { getPositionShortLabel } from '@/lib/positionLabels';
import { getTrainingAttributeLabel } from '@/lib/trainingLabels';
import { cn } from '@/lib/utils';
import { Player } from '@/types';

interface PlayerCardProps {
  player: Player;
  onMoveToStarting?: () => void;
  moveToStartingLabel?: string;
  onMoveToBench?: () => void;
  onMoveToReserve?: () => void;
  onPromoteToTeam?: () => void;
  onListForTransfer?: () => void;
  onReleasePlayer?: () => void;
  onRenamePlayer?: () => void;
  onNegotiateSalary?: () => void;
  onExtendContract?: () => void;
  onFirePlayer?: () => void;
  onShowDetails?: () => void;
  onSelect?: () => void;
  showActions?: boolean;
  compact?: boolean;
  defaultCollapsed?: boolean;
  condensedStats?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  leagueId?: string | null;
  ratingAnnotation?: string;
}

const POSITION_COLOR: Record<string, string> = {
  GK: 'bg-yellow-500',
  CB: 'bg-blue-500',
  LB: 'bg-blue-400',
  RB: 'bg-blue-400',
  CM: 'bg-green-500',
  LM: 'bg-green-400',
  RM: 'bg-green-400',
  CAM: 'bg-purple-500',
  LW: 'bg-orange-400',
  RW: 'bg-orange-400',
  ST: 'bg-red-500',
};

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

export const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  onMoveToStarting,
  moveToStartingLabel,
  onMoveToBench,
  onMoveToReserve,
  onPromoteToTeam,
  onListForTransfer,
  onReleasePlayer,
  onRenamePlayer,
  onNegotiateSalary,
  onExtendContract,
  onFirePlayer,
  onShowDetails,
  onSelect,
  showActions = true,
  compact = false,
  defaultCollapsed = false,
  condensedStats = false,
  draggable = false,
  onDragStart,
  onDragEnd,
  leagueId = null,
  ratingAnnotation,
}) => {
  const { language, t } = useTranslation();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    if (onSelect) {
      onSelect();
      return;
    }

    if (onShowDetails) {
      onShowDetails();
      return;
    }

    if (!collapsed) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-player-card-ignore-click]')) {
      return;
    }

    setCollapsed(false);
  };

  useEffect(() => {
    if (collapsed) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as HTMLElement | null;

      if (!target) {
        return;
      }

      if (cardRef.current?.contains(target)) {
        return;
      }

      if (target.closest('[data-radix-popper-content-wrapper]')) {
        return;
      }

      setCollapsed(true);
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [collapsed]);

  const positionBadge = POSITION_COLOR[player.position] ?? 'bg-gray-500';

  const health = clampPerformanceGauge(player.health, 1);
  const condition = clampPerformanceGauge(player.condition);
  const motivation = clampPerformanceGauge(player.motivation);
  const contractExpiresAt = player.contract?.expiresAt
    ? new Date(player.contract.expiresAt)
    : null;
  const contractStatus = player.contract?.status ?? 'active';
  const isContractExpired =
    contractExpiresAt !== null && contractExpiresAt.getTime() <= Date.now();
  const contractBadgeVariant =
    contractStatus === 'released'
      ? 'secondary'
      : isContractExpired
        ? 'destructive'
        : 'outline';
  const contractLabel =
    contractStatus === 'released'
      ? t('common.contract.released')
      : formatContractCountdown(contractExpiresAt, leagueId, language);
  const power = useMemo(
    () =>
      calculatePowerIndex({
        ...player,
        condition,
        motivation,
      }),
    [player, condition, motivation],
  );

  const renderedStats = (
    <>
      <div
        className={cn(
          'mb-3 grid grid-cols-2 gap-2 md:grid-cols-4',
          (compact || condensedStats) && 'gap-1',
        )}
      >
        <PerformanceGauge
          label={t('common.playerStatusCard.metrics.power')}
          value={power}
          className={compact ? 'space-y-0.5' : ''}
        />
        <PerformanceGauge
          label={t('common.playerStatusCard.metrics.health')}
          value={health}
          className={compact ? 'space-y-0.5' : ''}
        />
        <PerformanceGauge
          label={t('common.playerStatusCard.metrics.condition')}
          value={condition}
          className={compact ? 'space-y-0.5' : ''}
        />
        <PerformanceGauge
          label={t('common.playerStatusCard.metrics.motivation')}
          value={motivation}
          className={compact ? 'space-y-0.5' : ''}
        />
      </div>

      <div className={cn('grid grid-cols-2 gap-1', (compact || condensedStats) && 'gap-0.5')}>
        {ATTRIBUTE_KEYS.map((key) => (
          <StatBar
            key={key}
            label={getTrainingAttributeLabel(key)}
            value={player.attributes[key]}
            condensed={compact || condensedStats}
          />
        ))}
      </div>
    </>
  );

  return (
    <Card
      ref={cardRef}
      className={cn(
        'p-4 transition-shadow hover:shadow-md',
        compact && 'p-2',
        collapsed && 'cursor-pointer',
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={handleCardClick}
      onDoubleClick={() => !onShowDetails && setCollapsed((prev) => !prev)}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-gray-100 to-gray-200 px-2 text-center text-[10px] font-semibold leading-tight dark:from-gray-700 dark:to-gray-800',
              compact && 'h-8 w-8 px-1 text-[8px]',
            )}
          >
            <span className="block w-full truncate whitespace-nowrap">{player.name}</span>
          </div>
          <div
            className={cn(
              'absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white',
              positionBadge,
              compact && 'h-4 w-4 text-[10px]',
            )}
          >
            {getPositionShortLabel(player.position, language)}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className={cn('mb-2 flex items-center justify-between', compact && 'mb-1')}>
            <div>
              <h3 className={cn('truncate font-semibold text-sm', compact && 'text-xs')}>
                {player.name}
              </h3>
              <div
                className={cn(
                  'mt-1 flex items-center gap-2 text-xs',
                  compact && 'mt-0 gap-1 text-[10px]',
                )}
              >
                <Badge variant="secondary" className={cn('text-xs', compact && 'text-[10px]')}>
                  {t('common.ageShort', { age: player.age })}
                </Badge>
                {player.contract && (
                  <Badge
                    variant={contractBadgeVariant}
                    className={cn('text-xs', compact && 'text-[10px]')}
                  >
                    {contractLabel}
                  </Badge>
                )}
                {player.injuryStatus === 'injured' && (
                  <Badge variant="destructive" className={cn('text-xs', compact && 'text-[10px]')}>
                    {t('common.injury.injured')}
                  </Badge>
                )}
                <div
                  className={cn(
                    'flex items-center gap-1 text-muted-foreground',
                    compact && 'gap-0.5',
                  )}
                >
                  <TrendingUp className={cn('h-3 w-3', compact && 'h-2.5 w-2.5')} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-semibold">{formatRatingLabel(player.overall)}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('common.playerCard.maxPotential', {
                        value: formatRatingLabel(player.potential),
                      })}
                    </TooltipContent>
                  </Tooltip>
                </div>
                {ratingAnnotation ? (
                  <div className="text-[10px] text-muted-foreground">{ratingAnnotation}</div>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {(player.roles ?? []).map((role) => (
                    <Badge
                      key={role}
                      variant="outline"
                      className={cn('text-xs', compact && 'text-[10px]')}
                    >
                      {getPositionShortLabel(role, language)}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {showActions &&
              (onShowDetails ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn('h-8 w-8 p-0', compact && 'h-6 w-6')}
                  data-player-card-ignore-click
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowDetails();
                  }}
                >
                  <MoreVertical className={cn('h-4 w-4', compact && 'h-3 w-3')} />
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn('h-8 w-8 p-0', compact && 'h-6 w-6')}
                      data-player-card-ignore-click
                    >
                      <MoreVertical className={cn('h-4 w-4', compact && 'h-3 w-3')} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setCollapsed((prev) => !prev)}>
                      {collapsed ? t('common.playerCard.expand') : t('common.playerCard.collapse')}
                    </DropdownMenuItem>
                    {player.squadRole !== 'starting' && onMoveToStarting && (
                      <DropdownMenuItem onClick={onMoveToStarting}>
                        {moveToStartingLabel || t('common.playerCard.moveToStarting')}
                      </DropdownMenuItem>
                    )}
                    {player.squadRole !== 'bench' && onMoveToBench && (
                      <DropdownMenuItem onClick={onMoveToBench}>
                        {t('common.playerCard.moveToBench')}
                      </DropdownMenuItem>
                    )}
                    {player.squadRole !== 'reserve' && onMoveToReserve && (
                      <DropdownMenuItem onClick={onMoveToReserve}>
                        {t('common.playerCard.moveToReserve')}
                      </DropdownMenuItem>
                    )}
                    {(onRenamePlayer ||
                      onNegotiateSalary ||
                      onListForTransfer ||
                      onExtendContract ||
                      onReleasePlayer ||
                      onFirePlayer) && <DropdownMenuSeparator />}
                    {onRenamePlayer && (
                      <DropdownMenuItem onClick={onRenamePlayer}>
                        {t('common.playerCard.customizeName')}
                      </DropdownMenuItem>
                    )}
                    {onNegotiateSalary && (
                      <DropdownMenuItem onClick={onNegotiateSalary}>
                        {t('common.playerCard.negotiateSalary')}
                      </DropdownMenuItem>
                    )}
                    {onListForTransfer && (
                      <DropdownMenuItem onClick={onListForTransfer}>
                        {t('common.playerCard.sellPlayer')}
                      </DropdownMenuItem>
                    )}
                    {onExtendContract && (
                      <DropdownMenuItem onClick={onExtendContract}>
                        {t('common.playerCard.extendContract')}
                      </DropdownMenuItem>
                    )}
                    {onReleasePlayer && (
                      <DropdownMenuItem onClick={onReleasePlayer}>
                        {t('common.playerCard.releasePlayer')}
                      </DropdownMenuItem>
                    )}
                    {onFirePlayer && (
                      <DropdownMenuItem className="text-destructive" onClick={onFirePlayer}>
                        {t('common.playerCard.firePlayer')}
                      </DropdownMenuItem>
                    )}
                    {player.squadRole === 'youth' && onPromoteToTeam && (
                      <DropdownMenuItem onClick={onPromoteToTeam}>
                        {t('common.playerCard.moveToTeam')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
          </div>

          {!collapsed && renderedStats}
        </div>
      </div>
    </Card>
  );
};

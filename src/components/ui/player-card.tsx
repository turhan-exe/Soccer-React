import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Player } from '@/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatBar } from '@/components/ui/stat-bar';
import { PerformanceGauge, clampPerformanceGauge } from '@/components/ui/performance-gauge';
import { Button } from '@/components/ui/button';
import { MoreVertical, TrendingUp } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { calculatePowerIndex, formatRatingLabel } from '@/lib/player';
import { cn } from '@/lib/utils';
import { formatContractCountdown } from '@/lib/contracts';

interface PlayerCardProps {
  player: Player;
  onMoveToStarting?: () => void;
  onMoveToBench?: () => void;
  onMoveToReserve?: () => void;
  onPromoteToTeam?: () => void;
  onListForTransfer?: () => void;
  onReleasePlayer?: () => void;
  onRenamePlayer?: () => void;
  onFirePlayer?: () => void;
  showActions?: boolean;
  compact?: boolean;
  defaultCollapsed?: boolean;
  condensedStats?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  leagueId?: string | null;
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

export const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  onMoveToStarting,
  onMoveToBench,
  onMoveToReserve,
  onPromoteToTeam,
  onListForTransfer,
  onReleasePlayer,
  onRenamePlayer,
  onFirePlayer,
  showActions = true,
  compact = false,
  defaultCollapsed = false,
  condensedStats = false,
  draggable = false,
  onDragStart,
  onDragEnd,
  leagueId = null,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!collapsed) {
      return;
    }

    // Prevent toggling when the click originates from interactive elements that
    // should handle their own behaviour (e.g. dropdown triggers).
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

    const handlePointerDown = (event: MouseEvent) => {
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
      ? 'Serbest'
      : formatContractCountdown(contractExpiresAt, leagueId);
  const power = useMemo(
    () =>
      calculatePowerIndex({
        ...player,
        condition,
        motivation,
      }),
    [player, condition, motivation]
  );

  const renderedStats = (
    <>
      <div className={cn('mb-3 grid grid-cols-3 gap-2', (compact || condensedStats) && 'gap-1')}>
        <PerformanceGauge label="Güç" value={power} className={compact ? 'space-y-0.5' : ''} />
        <PerformanceGauge label="Kondisyon" value={condition} className={compact ? 'space-y-0.5' : ''} />
        <PerformanceGauge label="Motivasyon" value={motivation} className={compact ? 'space-y-0.5' : ''} />
      </div>

      <div className={cn('grid grid-cols-2 gap-1', (compact || condensedStats) && 'gap-0.5')}>
        <StatBar label="Güç" value={player.attributes.strength} condensed={compact || condensedStats} />
        <StatBar label="Hızlanma" value={player.attributes.acceleration} condensed={compact || condensedStats} />
        <StatBar label="Maks Hız" value={player.attributes.topSpeed} condensed={compact || condensedStats} />
        <StatBar label="Dribling Hızı" value={player.attributes.dribbleSpeed} condensed={compact || condensedStats} />
        <StatBar label="Sıçrama" value={player.attributes.jump} condensed={compact || condensedStats} />
        <StatBar label="Mücadele" value={player.attributes.tackling} condensed={compact || condensedStats} />
        <StatBar label="Top Saklama" value={player.attributes.ballKeeping} condensed={compact || condensedStats} />
        <StatBar label="Pas" value={player.attributes.passing} condensed={compact || condensedStats} />
        <StatBar label="Uzun Top" value={player.attributes.longBall} condensed={compact || condensedStats} />
        <StatBar label="Çeviklik" value={player.attributes.agility} condensed={compact || condensedStats} />
        <StatBar label="Şut" value={player.attributes.shooting} condensed={compact || condensedStats} />
        <StatBar label="Şut Gücü" value={player.attributes.shootPower} condensed={compact || condensedStats} />
        <StatBar label="Pozisyon Alma" value={player.attributes.positioning} condensed={compact || condensedStats} />
        <StatBar label="Refleks" value={player.attributes.reaction} condensed={compact || condensedStats} />
        <StatBar label="Top Kontrolü" value={player.attributes.ballControl} condensed={compact || condensedStats} />
      </div>
    </>
  );

  return (
    <Card
      ref={cardRef}
      className={cn(
        'p-4 transition-shadow hover:shadow-md',
        compact && 'p-2',
        collapsed && 'cursor-pointer'
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={handleCardClick}
      onDoubleClick={() => setCollapsed((prev) => !prev)}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-gray-100 to-gray-200 px-2 text-center text-[10px] font-semibold leading-tight overflow-hidden dark:from-gray-700 dark:to-gray-800',
              compact && 'h-8 w-8 px-1 text-[8px]'
            )}
          >
            <span className="block w-full truncate whitespace-nowrap">
              {player.name}
            </span>
          </div>
          <div
            className={cn(
              'absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white',
              positionBadge,
              compact && 'h-4 w-4 text-[10px]'
            )}
          >
            {player.position}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className={cn('mb-2 flex items-center justify-between', compact && 'mb-1')}>
            <div>
              <h3 className={cn('truncate font-semibold text-sm', compact && 'text-xs')}>{player.name}</h3>
              <div className={cn('mt-1 flex items-center gap-2 text-xs', compact && 'mt-0 gap-1 text-[10px]')}>
                <Badge variant="secondary" className={cn('text-xs', compact && 'text-[10px]')}>
                  {player.age} yaş
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
                    Sakat
                  </Badge>
                )}
                <div className={cn('flex items-center gap-1 text-muted-foreground', compact && 'gap-0.5')}>
                  <TrendingUp className={cn('h-3 w-3', compact && 'h-2.5 w-2.5')} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-semibold">
                        {formatRatingLabel(player.overall)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Maks. Potansiyel: {formatRatingLabel(player.potential)}</TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(player.roles ?? []).map((role) => (
                    <Badge key={role} variant="outline" className={cn('text-xs', compact && 'text-[10px]')}>
                      {role}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {showActions && (
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
                    {collapsed ? 'Kartı Genişlet' : 'Kartı Küçült'}
                  </DropdownMenuItem>
                  {player.squadRole !== 'starting' && onMoveToStarting && (
                    <DropdownMenuItem onClick={onMoveToStarting}>İlk 11'e Al</DropdownMenuItem>
                  )}
                  {player.squadRole !== 'bench' && onMoveToBench && (
                    <DropdownMenuItem onClick={onMoveToBench}>Yedek Kulübesine Al</DropdownMenuItem>
                  )}
                  {player.squadRole !== 'reserve' && onMoveToReserve && (
                    <DropdownMenuItem onClick={onMoveToReserve}>Rezerve Al</DropdownMenuItem>
                  )}
                  {(onRenamePlayer || onListForTransfer || onReleasePlayer || onFirePlayer) && (
                    <DropdownMenuSeparator />
                  )}
                  {onRenamePlayer && (
                    <DropdownMenuItem onClick={onRenamePlayer}>İsim Özelleştir</DropdownMenuItem>
                  )}
                  {onListForTransfer && (
                    <DropdownMenuItem onClick={onListForTransfer}>Oyuncuyu Sat</DropdownMenuItem>
                  )}
                  {onReleasePlayer && (
                    <DropdownMenuItem onClick={onReleasePlayer}>Serbest Bırak</DropdownMenuItem>
                  )}
                  {onFirePlayer && (
                    <DropdownMenuItem className="text-destructive" onClick={onFirePlayer}>
                      Oyuncuyu Kov
                    </DropdownMenuItem>
                  )}
                  {player.squadRole === 'youth' && onPromoteToTeam && (
                    <DropdownMenuItem onClick={onPromoteToTeam}>Takıma Al</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {!collapsed && renderedStats}
        </div>
      </div>
    </Card>
  );
};


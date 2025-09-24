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
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { calculatePowerIndex } from '@/lib/player';
import { cn } from '@/lib/utils';

interface PlayerCardProps {
  player: Player;
  onMoveToStarting?: () => void;
  onMoveToBench?: () => void;
  onMoveToReserve?: () => void;
  onPromoteToTeam?: () => void;
  showActions?: boolean;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}

export const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  onMoveToStarting,
  onMoveToBench,
  onMoveToReserve,
  onPromoteToTeam,
  showActions = true,
  compact = false,
  draggable = false,
  onDragStart,
  onDragEnd,
}) => {
  const getPositionColor = (position: string) => {
    const colors = {
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
    return colors[position as keyof typeof colors] || 'bg-gray-500';
  };

  const condition = clampPerformanceGauge(player.condition);
  const motivation = clampPerformanceGauge(player.motivation);
  const power = calculatePowerIndex({
    ...player,
    condition,
    motivation,
  });

  return (
    <Card
      className={cn(
        'p-4 hover:shadow-md transition-shadow',
        compact && 'p-2'
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-start gap-3">
        {/* Player Avatar */}
        <div className="relative">
          <div
            className={cn(
              'w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 rounded-full flex items-center justify-center text-lg font-semibold',
              compact && 'w-8 h-8 text-sm'
            )}
          >
            {player.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div
            className={cn(
              'absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white',
              getPositionColor(player.position),
              compact && 'w-4 h-4 text-[10px]'
            )}
          >
            {player.position}
          </div>
        </div>

        {/* Player Info */}
        <div className="flex-1 min-w-0">
          <div className={cn('flex items-center justify-between mb-2', compact && 'mb-1')}>
            <div>
              <h3 className={cn('font-semibold text-sm truncate', compact && 'text-xs')}>{player.name}</h3>
              <div className={cn('flex items-center gap-2 mt-1', compact && 'gap-1 mt-0')}> 
                <Badge variant="secondary" className={cn('text-xs', compact && 'text-[10px]')}>{player.age} yaş</Badge>
                <div className={cn('flex items-center gap-1 text-xs text-muted-foreground', compact && 'text-[10px]')}> 
                  <TrendingUp className={cn('w-3 h-3', compact && 'w-2 h-2')} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-semibold">
                        {Math.round(player.overall * 100)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Maks. Potansiyel: {Math.round(player.potential * 100)}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex gap-1">
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
                  <Button variant="ghost" size="sm" className={cn('h-8 w-8 p-0', compact && 'h-6 w-6')}>
                    <MoreVertical className={cn('h-4 w-4', compact && 'h-3 w-3')} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {player.squadRole !== 'starting' && onMoveToStarting && (
                    <DropdownMenuItem onClick={onMoveToStarting}>
                      İlk 11'e Al
                    </DropdownMenuItem>
                  )}
                  {player.squadRole !== 'bench' && onMoveToBench && (
                    <DropdownMenuItem onClick={onMoveToBench}>
                      Yedek Kulübesine Al
                    </DropdownMenuItem>
                  )}
                  {player.squadRole !== 'reserve' && onMoveToReserve && (
                    <DropdownMenuItem onClick={onMoveToReserve}>
                      Rezerve Al
                    </DropdownMenuItem>
                  )}
                  {player.squadRole === 'youth' && onPromoteToTeam && (
                    <DropdownMenuItem onClick={onPromoteToTeam}>
                      Takıma Al
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className={cn('mb-3 grid grid-cols-3 gap-2', compact && 'gap-1')}>
            <PerformanceGauge label="Guc" value={power} className={compact ? 'space-y-0.5' : ''} />
            <PerformanceGauge label="Kondisyon" value={condition} className={compact ? 'space-y-0.5' : ''} />
            <PerformanceGauge label="Motivasyon" value={motivation} className={compact ? 'space-y-0.5' : ''} />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-1">
            <StatBar label="Güç" value={player.attributes.strength} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Hızlanma" value={player.attributes.acceleration} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Maks Hız" value={player.attributes.topSpeed} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Dribling Hızı" value={player.attributes.dribbleSpeed} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Sıçrama" value={player.attributes.jump} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Mücadele" value={player.attributes.tackling} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Top Saklama" value={player.attributes.ballKeeping} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Pas" value={player.attributes.passing} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Uzun Top" value={player.attributes.longBall} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Çeviklik" value={player.attributes.agility} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Şut" value={player.attributes.shooting} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Şut Gücü" value={player.attributes.shootPower} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Pozisyon Alma" value={player.attributes.positioning} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Refleks" value={player.attributes.reaction} className={compact ? 'text-[10px]' : ''} />
            <StatBar label="Top Kontrolü" value={player.attributes.ballControl} className={compact ? 'text-[10px]' : ''} />
          </div>
        </div>
      </div>
    </Card>
  );
};
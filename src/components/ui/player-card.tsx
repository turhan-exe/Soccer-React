import { Player } from '@/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatBar } from '@/components/ui/stat-bar';
import { Button } from '@/components/ui/button';
import { MoreVertical, TrendingUp } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface PlayerCardProps {
  player: Player;
  onMoveToStarting?: () => void;
  onMoveToBench?: () => void;
  onMoveToReserve?: () => void;
  onPromoteToTeam?: () => void;
  showActions?: boolean;
}

export const PlayerCard: React.FC<PlayerCardProps> = ({ 
  player, 
  onMoveToStarting,
  onMoveToBench,
  onMoveToReserve,
  onPromoteToTeam,
  showActions = true
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

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {/* Player Avatar */}
        <div className="relative">
          <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 rounded-full flex items-center justify-center text-lg font-semibold">
            {player.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${getPositionColor(player.position)}`}>
            {player.position}
          </div>
        </div>

        {/* Player Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-semibold text-sm truncate">{player.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">{player.age} yaş</Badge>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingUp className="w-3 h-3" />
                  <span className="font-semibold">{player.overall.toFixed(3)}</span>
                </div>
              </div>
            </div>
            
            {showActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {player.category !== 'starting' && onMoveToStarting && (
                    <DropdownMenuItem onClick={onMoveToStarting}>
                      İlk 11'e Al
                    </DropdownMenuItem>
                  )}
                  {player.category !== 'bench' && onMoveToBench && (
                    <DropdownMenuItem onClick={onMoveToBench}>
                      Yedek Kulübesine Al
                    </DropdownMenuItem>
                  )}
                  {player.category !== 'reserve' && onMoveToReserve && (
                    <DropdownMenuItem onClick={onMoveToReserve}>
                      Rezerve Al
                    </DropdownMenuItem>
                  )}
                  {player.category === 'youth' && onPromoteToTeam && (
                    <DropdownMenuItem onClick={onPromoteToTeam}>
                      Takıma Al
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Stats */}
          <div className="space-y-1">
            <StatBar label="Hız" value={player.stats.speed} />
            <StatBar label="Şut" value={player.stats.shooting} />
            <StatBar label="Pas" value={player.stats.passing} />
            <StatBar label="Savunma" value={player.stats.defending} />
          </div>
        </div>
      </div>
    </Card>
  );
};
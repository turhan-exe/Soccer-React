import { AcademyCandidate, acceptCandidate, releaseCandidate } from '@/services/academy';
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
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  candidate: AcademyCandidate;
}

const CandidateCard: React.FC<Props> = ({ candidate }) => {
  const { player } = candidate;
  const { user } = useAuth();

  const handleAccept = async () => {
    if (!user) return;
    try {
      await acceptCandidate(user.id, candidate.id);
    } catch (err) {
      console.warn(err);
    }
  };

  const handleRelease = async () => {
    if (!user) return;
    try {
      await releaseCandidate(user.id, candidate.id);
    } catch (err) {
      console.warn(err);
    }
  };
  const initials = player.name
    .split(' ')
    .map((n) => n[0])
    .join('');

  const avatarClass =
    'w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 rounded-full flex items-center justify-center text-lg font-semibold';
  const positionBadgeClass =
    'absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white bg-gray-500';

  return (
    <Card
      data-testid={`academy-candidate-${candidate.id}`}
      className="p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <div className={avatarClass}>{initials}</div>
          <div className={positionBadgeClass}>{player.position}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-semibold text-sm truncate">{player.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">
                  {player.age} yaş
                </Badge>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingUp className="w-3 h-3" />
                  <span className="font-semibold">{player.overall.toFixed(3)}</span>
                </div>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleAccept}>Takıma Al</DropdownMenuItem>
                <DropdownMenuItem onClick={handleRelease}>Serbest Bırak</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="space-y-1">
            <StatBar label="Hız" value={player.attributes.topSpeed} />
            <StatBar label="Şut" value={player.attributes.shooting} />
          </div>
        </div>
      </div>
    </Card>
  );
};

export default CandidateCard;


import { AcademyCandidate } from '@/services/academy';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatBar } from '@/components/ui/stat-bar';
import { TrendingUp } from 'lucide-react';

interface Props {
  candidate: AcademyCandidate;
}

const CandidateCard: React.FC<Props> = ({ candidate }) => {
  const { player } = candidate;
  const initials = player.name
    .split(' ')
    .map((n) => n[0])
    .join('');

  return (
    <Card
      data-testid={`academy-candidate-${candidate.id}`}
      className="p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 rounded-full flex items-center justify-center text-lg font-semibold">
            {initials}
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white bg-gray-500">
            {player.position}
          </div>
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


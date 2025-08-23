import { YouthCandidate } from '@/services/youth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatBar } from '@/components/ui/stat-bar';
import { Button } from '@/components/ui/button';
import { TrendingUp } from 'lucide-react';

interface Props {
  candidate: YouthCandidate;
  onAccept: (id: string) => void;
  onRelease: (id: string) => void;
}

const YouthCandidateCard: React.FC<Props> = ({ candidate, onAccept, onRelease }) => {
  const { player } = candidate;
  const initials = player.name
    .split(' ')
    .map((n) => n[0])
    .join('');

  const attributeEntries: [string, number][] = [
    ['Hız', player.attributes.topSpeed],
    ['Şut', player.attributes.shooting],
    ['Güç', player.attributes.strength],
    ['İvme', player.attributes.acceleration],
    ['Top Sürme', player.attributes.dribbleSpeed],
    ['Zıplama', player.attributes.jump],
    ['Savunma', player.attributes.tackling],
    ['Top Saklama', player.attributes.ballKeeping],
    ['Pas', player.attributes.passing],
    ['Uzun Pas', player.attributes.longBall],
    ['Çeviklik', player.attributes.agility],
    ['Şut Gücü', player.attributes.shootPower],
    ['Pozisyon Alma', player.attributes.positioning],
    ['Reaksiyon', player.attributes.reaction],
    ['Top Kontrolü', player.attributes.ballControl],
  ];

  const basicStats = attributeEntries.slice(0, 2);
  const extraStats = attributeEntries.slice(2);

  return (
    <Card
      data-testid={`youth-candidate-${candidate.id}`}
      className="p-4 hover:shadow-md transition-all transform hover:scale-105 group"
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
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAccept(candidate.id)}
                data-testid={`youth-accept-${candidate.id}`}
              >
                Takıma Al
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRelease(candidate.id)}
                data-testid={`youth-release-${candidate.id}`}
              >
                Serbest Bırak
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            {basicStats.map(([label, value]) => (
              <StatBar key={label} label={label} value={value} />
            ))}
            <div className="hidden group-hover:block space-y-1 mt-2">
              {extraStats.map(([label, value]) => (
                <StatBar key={label} label={label} value={value} />
              ))}
              <div className="text-xs text-muted-foreground mt-2">
                Boy: {player.height} cm · Kilo: {player.weight} kg
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default YouthCandidateCard;

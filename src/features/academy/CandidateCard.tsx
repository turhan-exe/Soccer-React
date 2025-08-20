import { AcademyCandidate } from '@/services/academy';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  candidate: AcademyCandidate;
  onAccept: () => void;
  onRelease: () => void;
}

const CandidateCard: React.FC<Props> = ({ candidate, onAccept, onRelease }) => {
  const { id, player } = candidate;
  return (
    <Card data-testid={`academy-candidate-${id}`} className="relative">
      <div className="absolute top-2 right-2 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onAccept}
          data-testid={`academy-accept-${id}`}
        >
          Takıma Al
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={onRelease}
          data-testid={`academy-release-${id}`}
        >
          Serbest Bırak
        </Button>
      </div>
      <CardHeader>
        <CardTitle>
          {player.name} ({player.position})
        </CardTitle>
        <CardDescription>{player.age} yaş</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        <div>
          OVR: {player.overall} POT: {player.potential}
        </div>
        {player.traits && player.traits.length > 0 && (
          <div>Özellikler: {player.traits.join(', ')}</div>
        )}
      </CardContent>
    </Card>
  );
};

export default CandidateCard;

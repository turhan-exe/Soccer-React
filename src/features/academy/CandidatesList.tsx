import CandidateCard from './CandidateCard';
import { AcademyCandidate } from '@/services/academy';

interface Props {
  candidates: AcademyCandidate[];
  onAccept: (id: string) => void;
  onRelease: (id: string) => void;
}

const CandidatesList: React.FC<Props> = ({ candidates, onAccept, onRelease }) => {
  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">Henüz aday yok</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {candidates.map((c) => (
        <CandidateCard
          key={c.id}
          candidate={c}
          onAccept={onAccept}
          onRelease={onRelease}
        />
      ))}
    </div>
  );
};

export default CandidatesList;

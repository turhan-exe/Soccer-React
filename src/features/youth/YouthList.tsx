import YouthCandidateCard from './YouthCandidateCard';
import { YouthCandidate } from '@/services/youth';

interface Props {
  candidates: YouthCandidate[];
  onAccept: (id: string) => void;
  onRelease: (id: string) => void;
}

const YouthList: React.FC<Props> = ({ candidates, onAccept, onRelease }) => {
  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Henüz altyapı oyuncusu yok. Yeni aday üret.
      </p>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {candidates.map((c) => (
        <YouthCandidateCard
          key={c.id}
          candidate={c}
          onAccept={onAccept}
          onRelease={onRelease}
        />
      ))}
    </div>
  );
};

export default YouthList;

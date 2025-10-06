import CandidateCard from './CandidateCard';
import InfoPopupButton from '@/components/ui/info-popup-button';
import { AcademyCandidate } from '@/services/academy';

interface Props {
  candidates: AcademyCandidate[];
  onAccept: (id: string) => void;
  onRelease: (id: string) => void;
}

const CandidatesList: React.FC<Props> = ({ candidates, onAccept, onRelease }) => {
  if (candidates.length === 0) {
    return (
      <div className="flex justify-center py-6">
        <InfoPopupButton
          title="Altyapı Adayları"
          triggerLabel="Altyapı adayı yokken bilgi mesajını aç"
          message="Henüz aday yok"
        />
      </div>
    );
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

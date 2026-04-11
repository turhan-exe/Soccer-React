import CandidateCard from './CandidateCard';
import InfoPopupButton from '@/components/ui/info-popup-button';
import { useTranslation } from '@/contexts/LanguageContext';
import { AcademyCandidate } from '@/services/academy';

interface Props {
  candidates: AcademyCandidate[];
  onAccept: (id: string) => void;
  onRelease: (id: string) => void;
}

const CandidatesList: React.FC<Props> = ({ candidates, onAccept, onRelease }) => {
  const { t } = useTranslation();

  if (candidates.length === 0) {
    return (
      <div className="flex justify-center py-6">
        <InfoPopupButton
          title={t('academy.candidate.listTitle')}
          triggerLabel={t('academy.candidate.listTrigger')}
          message={t('academy.candidate.listEmpty')}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {candidates.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          onAccept={onAccept}
          onRelease={onRelease}
        />
      ))}
    </div>
  );
};

export default CandidatesList;

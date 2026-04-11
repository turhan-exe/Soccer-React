import YouthCandidateCard from './YouthCandidateCard';
import InfoPopupButton from '@/components/ui/info-popup-button';
import { useTranslation } from '@/contexts/LanguageContext';
import { YouthCandidate } from '@/services/youth';
import { cn } from '@/lib/utils';

interface Props {
  candidates: YouthCandidate[];
  onAccept: (id: string) => void;
  onRelease: (id: string) => void;
  className?: string;
  emptyStateClassName?: string;
}

const YouthList: React.FC<Props> = ({
  candidates,
  onAccept,
  onRelease,
  className,
  emptyStateClassName,
}) => {
  const { t } = useTranslation();

  if (candidates.length === 0) {
    return (
      <div className={cn('flex justify-center py-6', emptyStateClassName)}>
        <InfoPopupButton
          title={t('academy.candidate.poolTitle')}
          triggerLabel={t('academy.candidate.poolTrigger')}
          message={t('academy.candidate.poolEmpty')}
        />
      </div>
    );
  }

  return (
    <div className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-3', className)}>
      {candidates.map((candidate) => (
        <YouthCandidateCard
          key={candidate.id}
          candidate={candidate}
          onAccept={onAccept}
          onRelease={onRelease}
        />
      ))}
    </div>
  );
};

export default YouthList;

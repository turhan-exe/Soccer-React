import YouthCandidateCard from './YouthCandidateCard';
import InfoPopupButton from '@/components/ui/info-popup-button';
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
  if (candidates.length === 0) {
    return (
      <div className={cn('flex justify-center py-6', emptyStateClassName)}>
        <InfoPopupButton
          title="Oyuncu Havuzu"
          triggerLabel="Altyapı oyuncusu bulunmadığında bilgi mesajını aç"
          message="Henüz altyapı oyuncusu yok. Yeni aday üret."
        />
      </div>
    );
  }
  return (
    <div className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-3', className)}>
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

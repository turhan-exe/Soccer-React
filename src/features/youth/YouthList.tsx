import YouthCandidateCard from './YouthCandidateCard';
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
      <p className={cn('text-sm text-muted-foreground', emptyStateClassName)}>
        Henüz altyapı oyuncusu yok. Yeni aday üret.
      </p>
    );
  }
  return (
    <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-3', className)}>
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

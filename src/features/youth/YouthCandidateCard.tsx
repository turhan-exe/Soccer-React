import { YouthCandidate } from '@/services/youth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatBar } from '@/components/ui/stat-bar';
import { Button } from '@/components/ui/button';
import { TrendingUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/contexts/LanguageContext';
import { formatRatingLabel } from '@/lib/player';
import { getPositionShortLabel } from '@/lib/positionLabels';
import { getTrainingAttributeLabel } from '@/lib/trainingLabels';

interface Props {
  candidate: YouthCandidate;
  onAccept: (id: string) => void;
  onRelease: (id: string) => void;
}

const YouthCandidateCard: React.FC<Props> = ({ candidate, onAccept, onRelease }) => {
  const { t } = useTranslation();
  const { player } = candidate;
  const initials = player.name
    .split(' ')
    .map((name) => name[0])
    .join('');

  const attributeEntries: [string, number][] = [
    [getTrainingAttributeLabel('topSpeed'), player.attributes.topSpeed],
    [getTrainingAttributeLabel('shooting'), player.attributes.shooting],
    [getTrainingAttributeLabel('strength'), player.attributes.strength],
    [getTrainingAttributeLabel('acceleration'), player.attributes.acceleration],
    [getTrainingAttributeLabel('dribbleSpeed'), player.attributes.dribbleSpeed],
    [getTrainingAttributeLabel('jump'), player.attributes.jump],
    [getTrainingAttributeLabel('tackling'), player.attributes.tackling],
    [getTrainingAttributeLabel('ballKeeping'), player.attributes.ballKeeping],
    [getTrainingAttributeLabel('passing'), player.attributes.passing],
    [getTrainingAttributeLabel('longBall'), player.attributes.longBall],
    [getTrainingAttributeLabel('agility'), player.attributes.agility],
    [getTrainingAttributeLabel('shootPower'), player.attributes.shootPower],
    [getTrainingAttributeLabel('positioning'), player.attributes.positioning],
    [getTrainingAttributeLabel('reaction'), player.attributes.reaction],
    [getTrainingAttributeLabel('ballControl'), player.attributes.ballControl],
  ];

  const basicStats = attributeEntries.slice(0, 2);
  const extraStats = attributeEntries.slice(2);

  return (
    <Card
      data-testid={`youth-candidate-${candidate.id}`}
      className="group relative flex h-full min-h-[280px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 p-4 text-slate-100 shadow-lg backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400/40 hover:shadow-2xl sm:p-5 md:min-h-[320px] xl:min-w-0"
    >
      <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-emerald-500/20" />
      </div>
      <div className="relative flex flex-1 flex-col gap-3 xl:flex-row xl:items-start">
        <div className="relative shrink-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-emerald-500 text-base font-semibold text-white shadow-lg shadow-cyan-500/20">
            {initials}
          </div>
          <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-slate-950/80 text-[10px] font-bold text-cyan-100 shadow-md shadow-cyan-500/20">
            {getPositionShortLabel(player.position)}
          </div>
        </div>
        <div className="min-w-0 flex flex-1 flex-col">
          <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-start xl:justify-between">
            <div>
              <h3 className="truncate text-base font-semibold tracking-tight">{player.name}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <Badge variant="secondary" className="border-white/20 bg-white/10 text-white backdrop-blur">
                  {t('common.ageLong', { age: player.age })}
                </Badge>
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100 shadow-inner shadow-cyan-500/10">
                  <TrendingUp className="h-3 w-3" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-semibold">{formatRatingLabel(player.overall)}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('academy.candidate.potential', {
                        value: formatRatingLabel(player.potential),
                      })}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-wrap gap-1">
                  {player.roles.map((role) => (
                    <Badge
                      key={role}
                      variant="outline"
                      className="border-white/20 bg-transparent text-cyan-100"
                    >
                      {getPositionShortLabel(role)}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 xl:justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAccept(candidate.id)}
                data-testid={`youth-accept-${candidate.id}`}
                className="rounded-full border border-transparent bg-white/5 px-3 text-xs font-semibold text-cyan-100 shadow-sm transition hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-white"
              >
                {t('academy.candidate.promote')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRelease(candidate.id)}
                data-testid={`youth-release-${candidate.id}`}
                className="rounded-full border border-transparent bg-white/5 px-3 text-xs font-semibold text-slate-200 shadow-sm transition hover:border-rose-500/60 hover:bg-rose-500/20 hover:text-white"
              >
                {t('academy.candidate.release')}
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-1 flex-col justify-between">
            <div className="space-y-1">
              {basicStats.map(([label, value]) => (
                <StatBar key={label} label={label} value={value} className="text-slate-200" />
              ))}
            </div>
            <div className="mt-3 hidden space-y-1 text-[11px] text-slate-300 group-hover:block">
              {extraStats.map(([label, value]) => (
                <StatBar key={label} label={label} value={value} className="text-slate-200" />
              ))}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-300/90">
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  {t('academy.candidate.height', { value: player.height })}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  {t('academy.candidate.weight', { value: player.weight })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default YouthCandidateCard;

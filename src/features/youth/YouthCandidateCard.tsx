import { YouthCandidate } from '@/services/youth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatBar } from '@/components/ui/stat-bar';
import { Button } from '@/components/ui/button';
import { TrendingUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
      className="group relative flex h-full min-h-[340px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900/75 p-6 text-slate-100 shadow-xl backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400/40 hover:shadow-2xl sm:p-7 md:min-h-[380px] xl:min-w-[320px]"
    >
      <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-emerald-500/20" />
      </div>
      <div className="relative flex flex-1 flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative shrink-0">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-emerald-500 text-lg font-semibold text-white shadow-lg shadow-cyan-500/20">
            {initials}
          </div>
          <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-slate-950/80 text-[11px] font-bold text-cyan-100 shadow-md shadow-cyan-500/20">
            {player.position}
          </div>
        </div>
        <div className="min-w-0 flex flex-1 flex-col">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="truncate text-base font-semibold tracking-tight">{player.name}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary" className="border-white/20 bg-white/10 text-white backdrop-blur">
                  {player.age} yaş
                </Badge>
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[11px] font-medium text-cyan-100 shadow-inner shadow-cyan-500/10">
                  <TrendingUp className="h-3 w-3" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-semibold">
                        {Math.round(player.overall * 100)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Maks. Potansiyel: {Math.round(player.potential * 100)}
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
                      {role}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <div className="order-last mt-2 flex flex-col gap-2 sm:order-none sm:flex-row sm:flex-wrap sm:justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAccept(candidate.id)}
                data-testid={`youth-accept-${candidate.id}`}
                className="w-full rounded-full border border-cyan-400/40 bg-cyan-500/20 px-4 py-2 text-xs font-semibold text-cyan-50 shadow-lg shadow-cyan-500/20 transition hover:border-cyan-300 hover:bg-cyan-500/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 sm:w-auto"
              >
                Takıma Al
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRelease(candidate.id)}
                data-testid={`youth-release-${candidate.id}`}
                className="w-full rounded-full border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-xs font-semibold text-rose-100 shadow-lg shadow-rose-500/15 transition hover:border-rose-400 hover:bg-rose-500/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 sm:w-auto"
              >
                Serbest Bırak
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-1 flex-col justify-between">
            <div className="space-y-1">
              {basicStats.map(([label, value]) => (
                <StatBar key={label} label={label} value={value} className="text-slate-200" />
              ))}
            </div>
            <div className="mt-3 hidden space-y-1 text-xs text-slate-300 group-hover:block">
              {extraStats.map(([label, value]) => (
                <StatBar key={label} label={label} value={value} className="text-slate-200" />
              ))}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-300/90">
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  Boy: {player.height} cm
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  Kilo: {player.weight} kg
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

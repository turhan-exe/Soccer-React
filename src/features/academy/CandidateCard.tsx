import { AcademyCandidate } from '@/services/academy';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatBar } from '@/components/ui/stat-bar';
import { Button } from '@/components/ui/button';
import { TrendingUp } from 'lucide-react';
import { formatRatingLabel, getRoles } from '@/lib/player';
import type { Player } from '@/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  candidate: AcademyCandidate;
  onAccept: (id: string) => void;
  onRelease: (id: string) => void;
}

const mapPosition = (pos: string): Player['position'] => {
  const mapping: Record<string, Player['position']> = {
    GK: 'GK',
    DEF: 'CB',
    MID: 'CM',
    FWD: 'ST',
  };
  return mapping[pos] || 'CM';
};

const CandidateCard: React.FC<Props> = ({ candidate, onAccept, onRelease }) => {
  const { player } = candidate;
  const roles = getRoles(mapPosition(player.position));
  const initials = player.name
    .split(' ')
    .map((n) => n[0])
    .join('');

  const attributes = player.attributes as Partial<Player['attributes']>;
  const primaryStats: [string, number][] = [
    ['Hız', attributes.topSpeed ?? player.overall ?? 0],
    ['Şut', attributes.shooting ?? player.overall ?? 0],
  ];

  const secondaryStatKeys: Array<keyof Player['attributes']> = [
    'strength',
    'acceleration',
    'dribbleSpeed',
    'jump',
    'tackling',
    'ballKeeping',
    'passing',
    'longBall',
    'agility',
    'shootPower',
    'positioning',
    'reaction',
    'ballControl',
  ];

  const attributeLabelMap: Record<keyof Player['attributes'], string> = {
    strength: 'Güç',
    acceleration: 'İvme',
    topSpeed: 'Hız',
    dribbleSpeed: 'Top Sürme',
    jump: 'Zıplama',
    tackling: 'Savunma',
    ballKeeping: 'Top Saklama',
    passing: 'Pas',
    longBall: 'Uzun Pas',
    agility: 'Çeviklik',
    shooting: 'Şut',
    shootPower: 'Şut Gücü',
    positioning: 'Pozisyon Alma',
    reaction: 'Reaksiyon',
    ballControl: 'Top Kontrolü',
  };

  const secondaryStats = secondaryStatKeys
    .map<[string, number] | null>((key) => {
      const value = attributes?.[key];
      if (typeof value !== 'number') {
        return null;
      }
      return [attributeLabelMap[key], value];
    })
    .filter((entry): entry is [string, number] => entry !== null);

  return (
    <Card
      data-testid={`academy-candidate-${candidate.id}`}
      className="group relative flex h-full flex-col overflow-hidden border border-white/10 bg-slate-900/70 p-5 text-slate-100 shadow-lg backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400/40 hover:shadow-xl"
    >
      <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-emerald-500/20" />
      </div>
      <div className="relative flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-emerald-500 text-lg font-semibold text-white shadow-lg shadow-cyan-500/20">
                {initials}
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-slate-950/80 text-[11px] font-bold text-cyan-100 shadow-md shadow-cyan-500/20">
                {player.position}
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-tight">{player.name}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary" className="border-white/20 bg-white/10 text-white backdrop-blur">
                  {player.age} yaş
                </Badge>
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[11px] font-medium text-cyan-100 shadow-inner shadow-cyan-500/10">
                  <TrendingUp className="h-3 w-3" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-semibold">{formatRatingLabel(player.overall)}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Maks. Potansiyel: {formatRatingLabel(player.potential)}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-wrap gap-1">
                  {roles.map((role) => (
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
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAccept(candidate.id)}
              className="rounded-full border border-transparent bg-white/5 px-4 text-xs font-semibold text-cyan-100 shadow-sm transition hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-white"
            >
              Takıma Al
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRelease(candidate.id)}
              className="rounded-full border border-transparent bg-white/5 px-4 text-xs font-semibold text-slate-200 shadow-sm transition hover:border-rose-500/60 hover:bg-rose-500/20 hover:text-white"
            >
              Serbest Bırak
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          {primaryStats.map(([label, value]) => (
            <StatBar key={label} label={label} value={value} className="text-slate-200" />
          ))}
        </div>
        {secondaryStats.length > 0 && (
          <div className="mt-2 hidden space-y-1 text-xs text-slate-300 group-hover:block">
            {secondaryStats.map(([label, value]) => (
              <StatBar key={label} label={label} value={value} className="text-slate-200" />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

export default CandidateCard;


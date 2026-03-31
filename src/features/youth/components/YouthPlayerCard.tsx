import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PerformanceGauge } from '@/components/ui/performance-gauge';
import { YouthCandidate } from '@/services/youth';
import {
  getYouthAvatarUrl,
  getYouthDevelopmentGap,
  getYouthDevelopmentLabel,
  getYouthOverall,
  getYouthPotential,
  getYouthReadiness,
  getYouthRoleSummary,
} from '@/features/youth/youthPlayerPresentation';
import { Eye, ShieldCheck, Sparkles } from 'lucide-react';

interface YouthPlayerCardProps {
  candidate: YouthCandidate;
  onAccept: (id: string) => void;
  onRelease: (id: string) => void;
  onViewDetails: (candidate: YouthCandidate) => void;
}

const getPotentialTone = (gap: number): string => {
  if (gap >= 30) {
    return 'border-cyan-400/30 bg-cyan-500/12 text-cyan-100';
  }
  if (gap >= 20) {
    return 'border-emerald-400/30 bg-emerald-500/12 text-emerald-100';
  }
  if (gap >= 10) {
    return 'border-amber-400/30 bg-amber-500/12 text-amber-100';
  }
  return 'border-slate-400/30 bg-slate-500/12 text-slate-200';
};

const SummaryStat = ({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) => (
  <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-3 py-2">
    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-black text-white">{value}</p>
  </div>
);

export function YouthPlayerCard({
  candidate,
  onAccept,
  onRelease,
  onViewDetails,
}: YouthPlayerCardProps) {
  const { player } = candidate;
  const [avatarFailed, setAvatarFailed] = useState(false);

  const overall = getYouthOverall(player);
  const potential = getYouthPotential(player);
  const readiness = getYouthReadiness(player);
  const developmentGap = getYouthDevelopmentGap(player);
  const developmentLabel = getYouthDevelopmentLabel(developmentGap);
  const { primaryRole, secondaryRoles } = getYouthRoleSummary(player);
  const avatarUrl = useMemo(() => getYouthAvatarUrl(player), [player]);
  const initials = useMemo(
    () =>
      player.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase() ?? '')
        .join(''),
    [player.name],
  );

  return (
    <div className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(145deg,rgba(17,25,54,0.96),rgba(8,13,28,0.98))] p-5 text-slate-100 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition-all duration-200 hover:-translate-y-1 hover:border-cyan-300/35 hover:shadow-[0_24px_70px_rgba(34,211,238,0.16)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(168,85,247,0.16),transparent_30%)]" />

      <div className="relative z-10 flex items-start gap-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[22px] border border-cyan-300/20 bg-slate-950/70 shadow-[0_12px_30px_rgba(34,211,238,0.18)]">
          {!avatarFailed ? (
            <img
              src={avatarUrl}
              alt={`${player.name} avatarı`}
              className="h-full w-full object-cover"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-cyan-500 to-violet-500 text-2xl font-black text-white">
              {initials || 'A'}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-[clamp(1.7rem,2vw,2.1rem)] font-black leading-tight text-white">
                {player.name}
              </h3>
              <div className="mt-2 inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-sm font-semibold text-cyan-100">
                {primaryRole}
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onViewDetails(candidate)}
              className="h-9 self-start rounded-full border border-white/10 bg-white/6 px-4 text-xs font-semibold text-slate-100 hover:bg-white/12 hover:text-white"
            >
              <Eye className="mr-2 h-4 w-4" />
              Oyuncu Detayı
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <SummaryStat label="Yaş" value={player.age} />
            <SummaryStat label="Güç" value={overall} />
            <SummaryStat label="Potansiyel" value={potential} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge className="border-cyan-400/25 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/10">
              Ana Rol: {primaryRole}
            </Badge>
            {secondaryRoles.length > 0 ? (
              secondaryRoles.map(role => (
                <Badge
                  key={`${candidate.id}-${role}`}
                  variant="outline"
                  className="border-white/15 bg-white/5 text-slate-200"
                >
                  {role}
                </Badge>
              ))
            ) : (
              <Badge
                variant="outline"
                className="border-white/15 bg-white/5 text-slate-300"
              >
                Yan Rol Yok
              </Badge>
            )}
          </div>

          <div className="mt-4 rounded-[22px] border border-white/10 bg-slate-950/45 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Gelişim Seviyesi
                </p>
                <p className="mt-1 text-sm font-semibold text-white">{developmentLabel}</p>
              </div>
              <Badge className={getPotentialTone(developmentGap)}>+{developmentGap}</Badge>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/8 bg-white/5 p-3">
                <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
                  <span>Hazır Oluş</span>
                  <span className="text-slate-200">{readiness}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-900/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400"
                    style={{ width: `${readiness}%` }}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/5 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                  <Sparkles className="h-3.5 w-3.5 text-violet-300" />
                  <span>Ulaşabileceği Güç</span>
                </div>
                <p className="text-lg font-black text-white">{potential}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <PerformanceGauge
                label="Enerji"
                value={player.condition}
                variant="dark"
                className="rounded-2xl border border-white/8 bg-white/5 p-3"
              />
              <PerformanceGauge
                label="Moral"
                value={player.motivation}
                variant="dark"
                className="rounded-2xl border border-white/8 bg-white/5 p-3"
              />
              <PerformanceGauge
                label="Sağlık"
                value={player.health}
                variant="dark"
                className="rounded-2xl border border-white/8 bg-white/5 p-3"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4 text-cyan-300" />
          <span>Bu oyuncuyu istersen şimdi A takıma alabilirsin.</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onAccept(candidate.id)}
            className="text-sm font-semibold text-cyan-300 transition-colors hover:text-cyan-200"
          >
            A Takıma Al
          </button>
          <button
            onClick={() => onRelease(candidate.id)}
            className="text-sm font-semibold text-rose-300 transition-colors hover:text-rose-200"
          >
            Serbest Bırak
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 right-0 h-28 w-28 rounded-full bg-cyan-500/12 blur-3xl" />
      <div className="pointer-events-none absolute left-0 top-0 h-24 w-24 rounded-full bg-violet-500/12 blur-3xl" />
    </div>
  );
}

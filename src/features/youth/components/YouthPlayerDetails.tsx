import { useMemo, useState } from 'react';
import { HeartPulse, ShieldPlus, Sparkles, UserRound, X, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { PerformanceGauge } from '@/components/ui/performance-gauge';
import { StatBar } from '@/components/ui/stat-bar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getTrainingAttributeLabel } from '@/lib/trainingLabels';
import type { Player } from '@/types';
import {
  getYouthAvatarUrl,
  getYouthDevelopmentGap,
  getYouthDevelopmentLabel,
  getYouthOverall,
  getYouthPotential,
  getYouthReadiness,
  getYouthRoleSummary,
  toPercent,
} from '@/features/youth/youthPlayerPresentation';

interface YouthPlayerDetailsProps {
  player: Player | null;
  isOpen: boolean;
  onClose: () => void;
}

const ATTRIBUTE_KEYS: Array<keyof Player['attributes']> = [
  'strength',
  'acceleration',
  'topSpeed',
  'dribbleSpeed',
  'jump',
  'tackling',
  'ballKeeping',
  'passing',
  'longBall',
  'agility',
  'shooting',
  'shootPower',
  'positioning',
  'reaction',
  'ballControl',
];

const OverviewCard = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) => (
  <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3">
    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
    <p className={`mt-1 text-2xl font-black ${accent}`}>{value}</p>
  </div>
);

const DetailInfoRow = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => (
  <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
    <span className="text-sm text-slate-400">{label}</span>
    <span className="text-right text-sm font-semibold text-white">{value}</span>
  </div>
);

export function YouthPlayerDetails({ player, isOpen, onClose }: YouthPlayerDetailsProps) {
  const { language, t } = useTranslation();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarUrl = player ? getYouthAvatarUrl(player) : '';
  const initials = player
    ? player.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase() ?? '')
        .join('')
    : '';

  const attributeRows = useMemo(
    () => ATTRIBUTE_KEYS.map(key => ({ key, label: getTrainingAttributeLabel(key) })),
    [t],
  );

  if (!player) {
    return null;
  }

  const overall = getYouthOverall(player);
  const potential = getYouthPotential(player);
  const readiness = getYouthReadiness(player);
  const developmentGap = getYouthDevelopmentGap(player);
  const developmentLabel = getYouthDevelopmentLabel(developmentGap, language);
  const { primaryRole, secondaryRoles } = getYouthRoleSummary(player, language);

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(var(--app-viewport-height,100dvh)-1rem)] w-[calc(100vw-1rem)] max-w-[min(960px,calc(100vw-1rem))] flex-col overflow-hidden border border-white/10 bg-[linear-gradient(160deg,rgba(14,21,45,0.98),rgba(7,12,26,0.98))] p-0 text-slate-100 shadow-[0_30px_100px_rgba(0,0,0,0.55)] [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">{t('youth.details.dialogTitle')}</DialogTitle>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.15),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.18),transparent_26%)]" />

          <div className="relative shrink-0 border-b border-white/10 p-4 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-4 md:flex-row">
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-[26px] border border-cyan-300/20 bg-slate-950/80 shadow-[0_18px_40px_rgba(34,211,238,0.16)] sm:h-28 sm:w-28">
                  {!avatarFailed ? (
                    <img
                      src={avatarUrl}
                      alt={`${player.name} avatar`}
                      className="h-full w-full object-cover"
                      onError={() => setAvatarFailed(true)}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-cyan-500 to-violet-500 text-4xl font-black text-white">
                      {initials || 'A'}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">
                    {t('youth.details.profileEyebrow')}
                  </p>
                  <h2 className="mt-2 text-3xl font-black text-white">{player.name}</h2>
                  <p className="mt-1 text-sm font-medium leading-6 text-cyan-100">{primaryRole}</p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className="border-cyan-400/25 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/10">
                      {t('youth.details.primaryRole', { role: primaryRole })}
                    </Badge>
                    {secondaryRoles.length > 0 ? (
                      secondaryRoles.map(role => (
                        <Badge
                          key={`${player.id}-${role}`}
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
                        {t('youth.details.noSecondaryRole')}
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <OverviewCard label={t('youth.details.age')} value={player.age} accent="text-white" />
                    <OverviewCard label={t('youth.details.power')} value={overall} accent="text-amber-300" />
                    <OverviewCard label={t('youth.details.reachablePower')} value={potential} accent="text-cyan-300" />
                    <OverviewCard label={t('youth.details.remainingGrowth')} value={`+${developmentGap}`} accent="text-emerald-300" />
                  </div>
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-10 w-10 shrink-0 rounded-full border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <Tabs defaultValue="status" className="relative flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-white/10 px-4 py-3 sm:px-6">
              <TabsList className="grid h-auto w-full grid-cols-3 rounded-[20px] border border-white/10 bg-slate-950/70 p-1">
                <TabsTrigger value="status" className="rounded-2xl py-3 text-sm font-semibold text-slate-400 data-[state=active]:bg-cyan-500/12 data-[state=active]:text-cyan-100 data-[state=active]:shadow-none">
                  {t('youth.details.statusTab')}
                </TabsTrigger>
                <TabsTrigger value="skills" className="rounded-2xl py-3 text-sm font-semibold text-slate-400 data-[state=active]:bg-violet-500/12 data-[state=active]:text-violet-100 data-[state=active]:shadow-none">
                  {t('youth.details.skillsTab')}
                </TabsTrigger>
                <TabsTrigger value="profile" className="rounded-2xl py-3 text-sm font-semibold text-slate-400 data-[state=active]:bg-emerald-500/12 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none">
                  {t('youth.details.profileTab')}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              <TabsContent value="status" className="mt-0 space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-cyan-100">
                      <Zap className="h-4 w-4 text-cyan-300" />
                      {t('youth.details.performanceSummary')}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <PerformanceGauge
                        label={t('youth.details.power')}
                        value={overall / 100}
                        variant="dark"
                        className="rounded-2xl border border-white/10 bg-slate-950/55 p-3"
                      />
                      <PerformanceGauge
                        label={t('youth.details.reachablePower')}
                        value={potential / 100}
                        variant="dark"
                        className="rounded-2xl border border-white/10 bg-slate-950/55 p-3"
                      />
                      <PerformanceGauge
                        label={t('youth.details.energy')}
                        value={player.condition}
                        variant="dark"
                        className="rounded-2xl border border-white/10 bg-slate-950/55 p-3"
                      />
                      <PerformanceGauge
                        label={t('youth.details.morale')}
                        value={player.motivation}
                        variant="dark"
                        className="rounded-2xl border border-white/10 bg-slate-950/55 p-3"
                      />
                      <PerformanceGauge
                        label={t('youth.details.health')}
                        value={player.health}
                        variant="dark"
                        className="rounded-2xl border border-white/10 bg-slate-950/55 p-3"
                      />
                      <PerformanceGauge
                        label={t('youth.details.readiness')}
                        value={readiness / 100}
                        variant="dark"
                        className="rounded-2xl border border-white/10 bg-slate-950/55 p-3"
                      />
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-violet-100">
                      <Sparkles className="h-4 w-4 text-violet-300" />
                      {t('youth.details.playerSummary')}
                    </div>
                    <div className="space-y-3">
                      <DetailInfoRow label={t('youth.details.potentialLevel')} value={developmentLabel} />
                      <DetailInfoRow label={t('youth.details.remainingGrowth')} value={`+${developmentGap}`} />
                      <DetailInfoRow label={t('youth.details.energy')} value={`%${toPercent(player.condition)}`} />
                      <DetailInfoRow label={t('youth.details.morale')} value={`%${toPercent(player.motivation)}`} />
                      <DetailInfoRow label={t('youth.details.health')} value={`%${toPercent(player.health)}`} />
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="skills" className="mt-0">
                <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-violet-100">
                    <ShieldPlus className="h-4 w-4 text-violet-300" />
                    {t('youth.details.skillSection')}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {attributeRows.map(attribute => (
                      <StatBar
                        key={attribute.key}
                        label={attribute.label}
                        value={player.attributes[attribute.key]}
                        className="rounded-2xl border border-white/8 bg-slate-950/45 p-3"
                      />
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="profile" className="mt-0">
                <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-100">
                      <UserRound className="h-4 w-4 text-emerald-300" />
                      {t('youth.details.profileSection')}
                    </div>
                    <div className="space-y-3">
                      <DetailInfoRow label={t('youth.details.primaryRoleLabel')} value={primaryRole} />
                      <DetailInfoRow
                        label={t('youth.details.secondaryRolesLabel')}
                        value={secondaryRoles.join(', ') || t('youth.details.noSecondaryRole')}
                      />
                      <DetailInfoRow label={t('youth.details.age')} value={`${player.age}`} />
                      <DetailInfoRow label={t('youth.details.height')} value={`${player.height} cm`} />
                      <DetailInfoRow label={t('youth.details.weight')} value={`${player.weight} kg`} />
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-rose-100">
                      <HeartPulse className="h-4 w-4 text-rose-300" />
                      {t('youth.details.growthComment')}
                    </div>
                    <div className="space-y-3">
                      <DetailInfoRow label={t('youth.details.currentPower')} value={`${overall}`} />
                      <DetailInfoRow label={t('youth.details.reachablePower')} value={`${potential}`} />
                      <DetailInfoRow label={t('youth.details.readiness')} value={`%${readiness}`} />
                      <DetailInfoRow label={t('youth.details.remainingGrowth')} value={`+${developmentGap}`} />
                      <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-sm leading-6 text-slate-200">
                        {t('youth.details.analysis', {
                          overall,
                          potential,
                          gap: developmentGap,
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

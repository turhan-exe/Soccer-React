import React from 'react';
import {
  BatteryMedium,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  UserMinus,
  Wrench,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatRatingLabel } from '@/lib/player';
import { getPositionLabel } from '@/lib/positionLabels';
import { toGaugePercentage } from '@/lib/playerVitals';

import {
  type LineupReadinessIssue,
  type LineupVitalKey,
} from '../teamPlanningUtils';

type LineupReadinessDialogProps = {
  open: boolean;
  issues: LineupReadinessIssue[];
  thresholdPercent: number;
  onOpenChange: (open: boolean) => void;
  onUseKits: (playerId: string) => void;
  onBenchPlayer: (playerId: string) => void;
};

const vitalIconMap: Record<LineupVitalKey, React.ComponentType<{ className?: string }>> = {
  health: ShieldAlert,
  condition: BatteryMedium,
  motivation: Sparkles,
};

const renderMetricValue = (issue: LineupReadinessIssue, key: LineupVitalKey): number => {
  switch (key) {
    case 'health':
      return toGaugePercentage(issue.player.health, 1);
    case 'condition':
      return toGaugePercentage(issue.player.condition);
    case 'motivation':
      return toGaugePercentage(issue.player.motivation);
  }
};

export function LineupReadinessDialog({
  open,
  issues,
  thresholdPercent,
  onOpenChange,
  onUseKits,
  onBenchPlayer,
}: LineupReadinessDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,860px)] max-w-3xl overflow-hidden border border-amber-400/20 bg-[#091222]/95 p-0 text-slate-100 shadow-[0_24px_80px_rgba(15,23,42,0.7)] backdrop-blur-xl">
        <div className="border-b border-white/10 bg-gradient-to-r from-amber-500/10 via-white/0 to-emerald-400/10 px-6 py-5">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/25 bg-amber-400/10 text-amber-300 shadow-[0_0_30px_rgba(251,191,36,0.12)]">
                <TriangleAlert className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <DialogTitle className="text-2xl font-semibold text-white">
                  {t('teamPlanning.readiness.title')}
                </DialogTitle>
                <DialogDescription className="max-w-2xl text-sm leading-6 text-slate-300">
                  {t('teamPlanning.readiness.description', {
                    threshold: thresholdPercent,
                  })}
                </DialogDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge className="border-transparent bg-amber-400/15 px-3 py-1 text-amber-200">
                {t('teamPlanning.readiness.problemPlayers', { count: issues.length })}
              </Badge>
              <Badge className="border-transparent bg-white/10 px-3 py-1 text-slate-200">
                {t('teamPlanning.readiness.threshold', { threshold: thresholdPercent })}
              </Badge>
            </div>
          </DialogHeader>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-5">
          {issues.map((issue) => (
            <div
              key={issue.player.id}
              className="rounded-[24px] border border-white/10 bg-[#0f1729]/90 p-5 shadow-[0_18px_40px_rgba(2,6,23,0.35)]"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-white">{issue.player.name}</h3>
                    <Badge className="border-white/10 bg-white/5 text-slate-200">
                      {getPositionLabel(issue.player.position)}
                    </Badge>
                    <Badge className="border-white/10 bg-white/5 text-slate-300">
                      {t('teamPlanning.readiness.power', {
                        value: formatRatingLabel(issue.player.overall),
                      })}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {issue.failingVitals.map((vital) => (
                      <span
                        key={vital.key}
                        className="inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs font-semibold text-rose-200"
                      >
                        {t(`teamPlanning.metrics.${vital.key}`)} %{Math.round(vital.value * 100)}
                      </span>
                    ))}
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {(['health', 'condition', 'motivation'] as LineupVitalKey[]).map((key) => {
                      const Icon = vitalIconMap[key];
                      const percentage = renderMetricValue(issue, key);
                      const failing = issue.failingVitals.some((item) => item.key === key);
                      return (
                        <div
                          key={key}
                          className={`rounded-2xl border px-3 py-3 ${
                            failing
                              ? 'border-rose-400/30 bg-rose-400/10'
                              : 'border-white/10 bg-white/5'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                              <Icon className={`h-4 w-4 ${failing ? 'text-rose-300' : 'text-emerald-300'}`} />
                              <span>{t(`teamPlanning.metrics.${key}`)}</span>
                            </div>
                            <span className={`text-sm font-semibold ${failing ? 'text-rose-200' : 'text-white'}`}>
                              %{percentage}
                            </span>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full rounded-full transition-all ${
                                failing ? 'bg-rose-400' : 'bg-emerald-400'
                              }`}
                              style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex w-full flex-col gap-2 lg:w-[220px]">
                  <Button
                    className="h-11 rounded-xl bg-emerald-400 text-[#08131f] hover:bg-emerald-300"
                    onClick={() => onUseKits(issue.player.id)}
                  >
                    <Wrench className="mr-2 h-4 w-4" />
                    {t('teamPlanning.readiness.useKits')}
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-11 rounded-xl border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                    onClick={() => onBenchPlayer(issue.player.id)}
                  >
                    <UserMinus className="mr-2 h-4 w-4" />
                    {t('teamPlanning.readiness.removeFromStarting')}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default LineupReadinessDialog;

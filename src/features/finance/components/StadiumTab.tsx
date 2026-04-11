import { Building2, ChevronsUp, DollarSign, RefreshCcw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useTranslation } from '@/contexts/LanguageContext';
import type { StadiumLevelConfig } from '@/services/finance';
import { formatCurrency } from './FinanceHeader';

interface StadiumTabProps {
  level: number;
  config: StadiumLevelConfig;
  nextConfig: StadiumLevelConfig;
  estimatedMatchIncome: number;
  attendanceRate: number;
  occupiedSeats: number;
  balance: number;
  upgrading: boolean;
  onUpgrade: () => void;
  hasPermission: boolean | null;
}

export function StadiumTab({
  level,
  config,
  nextConfig,
  estimatedMatchIncome,
  attendanceRate,
  occupiedSeats,
  balance,
  upgrading,
  onUpgrade,
  hasPermission,
}: StadiumTabProps) {
  const { t, formatNumber } = useTranslation();
  const progress = (level / 5) * 100;
  const meetsCost = balance >= nextConfig.upgradeCost;
  const permissionGranted = hasPermission === true;
  const permissionPending = hasPermission === null;
  const canUpgrade = permissionGranted && level < 5 && meetsCost;

  const buttonLabel =
    level >= 5
      ? t('finance.stadium.maxLevel')
      : permissionPending
        ? t('finance.stadium.checkingPermission')
        : !permissionGranted
          ? t('finance.stadium.noPermission')
          : meetsCost
            ? t('finance.stadium.upgrade')
            : t('finance.stadium.insufficientBalance');

  return (
    <div className="grid animate-in gap-6 fade-in slide-in-from-bottom-4 duration-500">
      <Card className="border-white/5 bg-slate-900/60 p-1 shadow-xl backdrop-blur-sm">
        <div className="relative h-48 w-full overflow-hidden rounded-t-xl bg-slate-950">
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center opacity-20">
            <Building2 className="h-24 w-24 text-white" />
          </div>
          <div className="absolute bottom-4 left-4 z-20">
            <span className="mb-1 inline-block rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-950 shadow-lg">
              {t('finance.stadium.level', { level })}
            </span>
            <h2 className="text-2xl font-bold tracking-tight text-white">{t('finance.stadium.title')}</h2>
          </div>
        </div>

        <CardContent className="space-y-6 pt-6">
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
              <span>{t('finance.stadium.progress')}</span>
              <span>%{Math.round(progress)}</span>
            </div>
            <Progress
              value={progress}
              className="h-2 bg-slate-800"
              indicatorClassName="bg-gradient-to-r from-emerald-600 to-emerald-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StadiumStat
              icon={Users}
              label={t('finance.stadium.capacity')}
              value={formatNumber(config.capacity)}
              subValue={t('finance.summary.activeFans', { count: formatNumber(occupiedSeats) })}
              tone="blue"
            />
            <StadiumStat
              icon={DollarSign}
              label={t('finance.stadium.matchIncome')}
              value={formatCurrency(estimatedMatchIncome)}
              subValue={t('finance.stadium.occupancy', { value: Math.round(attendanceRate * 100) })}
              tone="emerald"
            />
          </div>

          {level < 5 && (
            <div className="space-y-4 rounded-xl border border-dashed border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
                    <ChevronsUp className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{t('finance.stadium.nextLevel')}</p>
                    <p className="text-xs text-slate-400">{t('finance.stadium.upgradeCost')}</p>
                  </div>
                </div>
                <span className={`font-mono text-lg font-bold ${meetsCost ? 'text-white' : 'text-rose-400'}`}>
                  {formatCurrency(nextConfig.upgradeCost)}
                </span>
              </div>

              <Button
                className={`w-full font-bold tracking-wide ${canUpgrade ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-slate-800 text-slate-400'}`}
                onClick={onUpgrade}
                disabled={level >= 5 || upgrading || !canUpgrade}
                size="lg"
              >
                {upgrading && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
                {buttonLabel}
              </Button>
            </div>
          )}

          {!permissionPending && !permissionGranted && (
            <p className="rounded bg-rose-500/10 p-2 text-center text-xs text-rose-400">
              {t('finance.stadium.ownerOnly')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StadiumStat({
  icon: Icon,
  label,
  value,
  subValue,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  subValue: string;
  tone: 'blue' | 'emerald';
}) {
  const colors =
    tone === 'blue'
      ? 'border-blue-500/20 bg-blue-500/10 text-blue-400'
      : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400';

  return (
    <div className={`flex flex-col rounded-xl border p-4 ${colors}`}>
      <Icon className="mb-2 h-4 w-4 opacity-80" />
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      <span className="text-xl font-bold tracking-tight text-white">{value}</span>
      <span className="text-[10px] opacity-60">{subValue}</span>
    </div>
  );
}

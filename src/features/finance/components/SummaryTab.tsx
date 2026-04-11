import { ArrowDownRight, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from '@/contexts/LanguageContext';
import type { ExpectedRevenueBreakdown, FinanceHistoryEntry } from '@/services/finance';
import { formatCurrency } from './FinanceHeader';

interface SummaryTabProps {
  totals: {
    totalIncome: number;
    totalExpense: number;
    net: number;
    incomeTotals: Record<string, number>;
    expenseTotals: Record<string, number>;
  };
  history: FinanceHistoryEntry[];
  chartData: { label: string; income: number; expense: number; net: number }[];
  averageMatchIncome: number;
  dailyIncomeEstimate: number;
  expectedRevenue: ExpectedRevenueBreakdown;
  balance: number;
  stadiumLevel: number;
  stadiumCapacity: number;
  onBuyCredit: () => void;
}

export function SummaryTab({
  totals,
  averageMatchIncome,
  dailyIncomeEstimate,
  expectedRevenue,
  balance,
  stadiumLevel,
  stadiumCapacity,
  onBuyCredit,
}: SummaryTabProps) {
  const { t, formatNumber } = useTranslation();

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6 duration-500">
      <div>
        <h2 className="mb-3 px-1 text-lg font-bold text-slate-200">{t('finance.summary.title')}</h2>
        <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 scrollbar-hide">
          <div className="group relative h-[120px] w-[240px] shrink-0 snap-center overflow-hidden rounded-[24px] border border-white/5 bg-[#1a1b2e]">
            <div className="pointer-events-none absolute right-0 top-0 -mr-10 -mt-10 h-24 w-24 rounded-full bg-indigo-500/10 blur-2xl" />
            <div className="relative z-10 flex h-full flex-col justify-between p-5">
              <div>
                <p className="mb-1 text-xs font-medium text-slate-400">
                  {t('finance.header.currentBalance')}
                </p>
                <p className="font-mono text-2xl font-bold tracking-tight text-white">
                  {formatCurrency(balance)}
                </p>
              </div>
              <Button
                size="sm"
                onClick={onBuyCredit}
                className="h-8 self-end rounded-full bg-cyan-500 px-4 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg shadow-cyan-500/20 hover:bg-cyan-600"
              >
                {t('finance.summary.loadBalance')}
              </Button>
            </div>
          </div>

          <div className="relative h-[120px] w-[200px] shrink-0 snap-center overflow-hidden rounded-[24px] border border-white/5 bg-[#1a1b2e]">
            <div className="pointer-events-none absolute bottom-0 left-0 -mb-10 -ml-10 h-24 w-24 rounded-full bg-purple-500/10 blur-2xl" />
            <div className="flex h-full flex-col justify-center p-5">
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 text-purple-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M3 21h18" />
                  <path d="M5 21v-7" />
                  <path d="M19 21v-7" />
                  <path d="M5 14a5 5 0 0 1 10 0v7" />
                  <path d="M15 14h4" />
                </svg>
              </div>
              <p className="mb-1 text-lg font-bold leading-none text-white">
                {t('finance.summary.stadiumLevel', { level: stadiumLevel })}
              </p>
              <p className="text-xs text-slate-500">
                {t('finance.summary.seats', { count: formatNumber(stadiumCapacity) })}
              </p>
            </div>
          </div>

          <div className="relative h-[120px] w-[200px] shrink-0 snap-center overflow-hidden rounded-[24px] border border-white/5 bg-[#1a1b2e]">
            <div className="pointer-events-none absolute left-0 top-0 -ml-10 -mt-10 h-24 w-24 rounded-full bg-emerald-500/10 blur-2xl" />
            <div className="flex h-full flex-col justify-center p-5">
              <div
                className={`mb-3 flex h-8 w-8 items-center justify-center rounded-full ${
                  totals.net >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                }`}
              >
                {totals.net >= 0 ? <TrendingUp className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              </div>
              <p className="mb-1 text-xs font-medium text-slate-400">{t('finance.summary.last30Net')}</p>
              <p
                className={`font-mono text-xl font-bold tracking-tight ${
                  totals.net >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {totals.net > 0 ? '+' : ''}
                {formatCurrency(totals.net)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden rounded-[24px] border-white/5 bg-[#1a1b2e] shadow-xl">
        <CardContent className="p-0">
          <div className="border-b border-white/5 bg-white/[0.03] px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
              {t('finance.summary.realized')}
            </p>
          </div>
          <div className="divide-y divide-white/5">
            <ListItem label={t('finance.summary.last30Income')} value={formatCurrency(totals.totalIncome)} valueColor="text-emerald-400" />
            <ListItem label={t('finance.summary.last30Expense')} value={formatCurrency(totals.totalExpense)} valueColor="text-rose-400" />
            <ListItem
              label={t('finance.summary.last30Net')}
              value={formatCurrency(totals.net)}
              valueColor={totals.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            />
          </div>

          <div className="border-y border-white/5 bg-white/[0.03] px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
              {t('finance.summary.expectedCashFlow')}
            </p>
          </div>
          <div className="divide-y divide-white/5">
            <ListItem label={t('finance.summary.matchIncome')} value={formatCurrency(averageMatchIncome)} valueColor="text-emerald-300" />
            <ListItem label={t('finance.summary.monthlyIncome')} value={formatCurrency(expectedRevenue.monthly)} valueColor="text-emerald-400" />
            <ListItem label={t('finance.summary.monthlySponsor')} value={formatCurrency(expectedRevenue.sponsorEstimate)} />
            <ListItem label={t('finance.summary.monthlySalary')} value={formatCurrency(expectedRevenue.projectedMonthlyExpense)} valueColor="text-rose-400" />
            <ListItem
              label={t('finance.summary.monthlyNet')}
              value={formatCurrency(expectedRevenue.projectedMonthlyNet)}
              valueColor={expectedRevenue.projectedMonthlyNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            />
            <ListItem label={t('finance.summary.dailyIncome')} value={formatCurrency(dailyIncomeEstimate)} valueColor="text-emerald-300" />
            <ListItem label={t('finance.summary.teamStrength')} value={expectedRevenue.teamStrength.toString()} />
            <ListItem
              label={t('finance.summary.occupancy')}
              value={`%${Math.round(expectedRevenue.attendanceRate * 100)} • ${formatNumber(expectedRevenue.occupiedSeats)}`}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ListItem({
  label,
  value,
  valueColor = 'text-white',
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="group flex items-center justify-between gap-4 p-5 transition-colors hover:bg-white/5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="h-2 w-2 rounded-full bg-slate-700 transition-colors group-hover:bg-indigo-500" />
        <span className="text-sm font-medium text-slate-300">{label}</span>
      </div>
      <div
        className={`shrink-0 rounded-lg border border-white/5 bg-black/20 px-3 py-1 font-mono font-bold tracking-tight ${valueColor}`}
      >
        {value}
      </div>
    </div>
  );
}

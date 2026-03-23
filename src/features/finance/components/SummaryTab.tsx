import { ArrowDownRight, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6 duration-500">
      <div>
        <h2 className="mb-3 px-1 text-lg font-bold text-slate-200">Finans Durumu</h2>
        <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 scrollbar-hide snap-x">
          <div className="h-[120px] w-[240px] shrink-0 snap-center overflow-hidden rounded-[24px] border border-white/5 bg-[#1a1b2e] group relative">
            <div className="pointer-events-none absolute -mr-10 -mt-10 right-0 top-0 h-24 w-24 rounded-full bg-indigo-500/10 blur-2xl" />
            <div className="relative z-10 flex h-full flex-col justify-between p-5">
              <div>
                <p className="mb-1 text-xs font-medium text-slate-400">Mevcut Bakiye</p>
                <p className="font-mono text-2xl font-bold tracking-tight text-white">
                  {formatCurrency(balance)}
                </p>
              </div>
              <Button
                size="sm"
                onClick={onBuyCredit}
                className="h-8 self-end rounded-full bg-cyan-500 px-4 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg shadow-cyan-500/20 hover:bg-cyan-600"
              >
                Bakiye Yükle
              </Button>
            </div>
          </div>

          <div className="h-[120px] w-[200px] shrink-0 snap-center overflow-hidden rounded-[24px] border border-white/5 bg-[#1a1b2e] relative">
            <div className="pointer-events-none absolute -mb-10 -ml-10 bottom-0 left-0 h-24 w-24 rounded-full bg-purple-500/10 blur-2xl" />
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
              <p className="mb-1 text-lg font-bold leading-none text-white">Stadyum Seviye {stadiumLevel}</p>
              <p className="text-xs text-slate-500">{stadiumCapacity.toLocaleString('tr-TR')} Koltuk</p>
            </div>
          </div>

          <div className="h-[120px] w-[200px] shrink-0 snap-center overflow-hidden rounded-[24px] border border-white/5 bg-[#1a1b2e] relative">
            <div className="pointer-events-none absolute -ml-10 -mt-10 left-0 top-0 h-24 w-24 rounded-full bg-emerald-500/10 blur-2xl" />
            <div className="flex h-full flex-col justify-center p-5">
              <div
                className={`mb-3 flex h-8 w-8 items-center justify-center rounded-full ${
                  totals.net >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                }`}
              >
                {totals.net >= 0 ? <TrendingUp className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              </div>
              <p className="mb-1 text-xs font-medium text-slate-400">Son 30 Gün Net</p>
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
              Gerçekleşen Finans
            </p>
          </div>
          <div className="divide-y divide-white/5">
            <ListItem label="Son 30 Gün Gelir" value={formatCurrency(totals.totalIncome)} valueColor="text-emerald-400" />
            <ListItem label="Son 30 Gün Gider" value={formatCurrency(totals.totalExpense)} valueColor="text-rose-400" />
            <ListItem
              label="Son 30 Gün Net"
              value={formatCurrency(totals.net)}
              valueColor={totals.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            />
          </div>

          <div className="border-y border-white/5 bg-white/[0.03] px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
              Beklenen Nakit Akışı
            </p>
          </div>
          <div className="divide-y divide-white/5">
            <ListItem label="Maç Başı Tahmini Gelir" value={formatCurrency(averageMatchIncome)} valueColor="text-emerald-300" />
            <ListItem label="Aylık Tahmini Gelir" value={formatCurrency(expectedRevenue.monthly)} valueColor="text-emerald-400" />
            <ListItem label="Aylık Sponsor Geliri" value={formatCurrency(expectedRevenue.sponsorEstimate)} />
            <ListItem label="Aylık Maaş Gideri" value={formatCurrency(expectedRevenue.projectedMonthlyExpense)} valueColor="text-rose-400" />
            <ListItem
              label="Aylık Tahmini Net"
              value={formatCurrency(expectedRevenue.projectedMonthlyNet)}
              valueColor={expectedRevenue.projectedMonthlyNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            />
            <ListItem label="Günlük Tahmini Gelir" value={formatCurrency(dailyIncomeEstimate)} valueColor="text-emerald-300" />
            <ListItem label="Takım Gücü" value={expectedRevenue.teamStrength.toString()} />
            <ListItem
              label="Doluluk / Seyirci"
              value={`%${Math.round(expectedRevenue.attendanceRate * 100)} • ${expectedRevenue.occupiedSeats.toLocaleString('tr-TR')}`}
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

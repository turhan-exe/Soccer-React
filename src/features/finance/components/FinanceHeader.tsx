import { BackButton } from '@/components/ui/back-button';

interface FinanceHeaderProps {
  balance: number;
}

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(value));

export function FinanceHeader({ balance }: FinanceHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-900/80 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <BackButton className="h-10 w-10 shrink-0 rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
              Finans Merkezi
            </p>
            <h1 className="truncate text-xl font-bold tracking-wide text-white">Genel Bakis</h1>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Mevcut Bakiye</span>
          <span className="font-mono text-lg font-bold tracking-tighter text-emerald-400">
            {formatCurrency(balance)}
          </span>
        </div>
      </div>
    </header>
  );
}

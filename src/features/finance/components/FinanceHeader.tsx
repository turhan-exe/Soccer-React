import { Badge } from '@/components/ui/badge';
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
    <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-900/80 backdrop-blur-md">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400 font-bold">Finans Merkezi</p>
            <h1 className="text-xl font-bold text-white tracking-wide">Genel Bakış</h1>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Mevcut Bakiye</span>
          <span className="text-lg font-bold text-emerald-400 font-mono tracking-tighter">
            {formatCurrency(balance)}
          </span>
        </div>
      </div>
    </header>
  );
}

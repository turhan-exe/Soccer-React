import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';
import { formatClubCurrency } from '@/lib/clubFinance';

interface TransferHeaderProps {
  teamName: string;
  budget: number;
}

export function TransferHeader({ teamName, budget }: TransferHeaderProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="relative mb-6 overflow-hidden rounded-[24px] bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 p-6 md:p-8">
      <div className="absolute -left-10 -top-10 h-64 w-64 bg-blue-500/20 blur-[100px]" />
      <div className="absolute -right-10 -bottom-10 h-64 w-64 bg-purple-500/20 blur-[100px]" />

      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="mt-1 h-10 w-10 shrink-0 rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => navigate(-1)}
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white md:text-4xl">{t('transfer.title')}</h1>
            <p className="max-w-xl text-sm text-blue-100/80 md:text-base">
              {t('transfer.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg">
            <ShieldIcon className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="text-lg font-bold text-white">{teamName}</div>
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span>{t('common.clubBalance')}</span>
              <span className="font-mono text-emerald-400">{formatClubCurrency(budget)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShieldIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    </svg>
  );
}

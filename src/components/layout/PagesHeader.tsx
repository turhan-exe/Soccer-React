import React from 'react';
import { Shield } from 'lucide-react';

import { BackButton } from '@/components/ui/back-button';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/LanguageContext';
import { useClubFinance } from '@/hooks/useClubFinance';
import { formatClubCurrency } from '@/lib/clubFinance';

interface PagesHeaderProps {
  title: string;
  description?: string;
  showBackButton?: boolean;
}

export function PagesHeader({
  title,
  description,
  showBackButton = true,
}: PagesHeaderProps) {
  const { user } = useAuth();
  const { cashBalance, diamondBalance, loading } = useClubFinance();
  const { formatNumber, t } = useTranslation();

  return (
    <div className="relative flex flex-col justify-between gap-4 overflow-hidden rounded-[24px] border border-white/5 bg-gradient-to-r from-blue-900/40 via-purple-900/40 to-slate-900/40 p-4 backdrop-blur-xl md:flex-row md:items-center">
      <div className="absolute top-0 left-0 h-full w-full bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
      <div className="absolute -top-24 -left-24 h-64 w-64 rounded-full bg-blue-600/20 blur-[80px]" />
      <div className="absolute -right-24 -bottom-24 h-64 w-64 rounded-full bg-purple-600/20 blur-[80px]" />

      <div className="relative z-10 flex min-w-0 items-center gap-4">
        {showBackButton ? (
          <BackButton className="bg-white/10 hover:bg-white/20 text-white border-white/10 h-10 w-10 shrink-0" />
        ) : null}
        <div className="min-w-0">
          <h1 className="bg-gradient-to-br from-white to-slate-400 bg-clip-text text-2xl font-bold text-transparent md:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="hidden text-xs font-medium text-slate-400 md:block">{description}</p>
          ) : null}
        </div>
      </div>

      <div className="relative z-10 flex w-full max-w-full min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-[#1e1b2e]/80 p-3 shadow-2xl backdrop-blur-md md:w-auto md:min-w-[240px]">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-0.5 shadow-lg">
          <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[10px] bg-slate-900">
            {user?.teamLogo ? (
              <img src={user.teamLogo} alt="Logo" className="h-full w-full object-cover" />
            ) : (
              <Shield className="h-5 w-5 text-indigo-400" />
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <h3 className="truncate pr-2 text-base font-bold leading-none text-white">
              {user?.teamName || t('pagesHeader.teamNamePlaceholder')}
            </h3>
            <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-[10px] font-medium">
            <div className="min-w-0">
              <div className="text-slate-400">{t('pagesHeader.clubBalance')}</div>
              <div className="truncate text-slate-200">
                {loading ? t('pagesHeader.loading') : formatClubCurrency(cashBalance)}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-slate-400">{t('pagesHeader.diamonds')}</div>
              <div className="truncate text-sky-300">{formatNumber(diamondBalance)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

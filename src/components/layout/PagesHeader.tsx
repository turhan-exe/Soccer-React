import React from 'react';
import { BackButton } from '@/components/ui/back-button';
import { Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClubFinance } from '@/hooks/useClubFinance';
import { formatClubCurrency } from '@/lib/clubFinance';

interface PagesHeaderProps {
    title: string;
    description?: string;
    showBackButton?: boolean;
}

export function PagesHeader({ title, description, showBackButton = true }: PagesHeaderProps) {
    const { user } = useAuth();
    const { cashBalance, diamondBalance, loading } = useClubFinance();

    return (
        <div className="relative flex flex-col justify-between gap-4 overflow-hidden rounded-[24px] border border-white/5 bg-gradient-to-r from-blue-900/40 via-purple-900/40 to-slate-900/40 p-4 backdrop-blur-xl md:flex-row md:items-center">
            {/* Background Gradients */}
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
            <div className="absolute -top-24 -left-24 w-64 h-64 bg-blue-600/20 rounded-full blur-[80px]" />
            <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-purple-600/20 rounded-full blur-[80px]" />

            {/* Left: Back + Title */}
            <div className="relative z-10 flex min-w-0 items-center gap-4">
                {showBackButton && (
                    <BackButton className="bg-white/10 hover:bg-white/20 text-white border-white/10 h-10 w-10 shrink-0" />
                )}
                <div className="min-w-0">
                    <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
                        {title}
                    </h1>
                    {description && (
                        <p className="text-slate-400 text-xs font-medium hidden md:block">
                            {description}
                        </p>
                    )}
                </div>
            </div>

            {/* Right: Team Summary Card */}
            <div className="relative z-10 flex w-full max-w-full min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-[#1e1b2e]/80 p-3 shadow-2xl backdrop-blur-md md:w-auto md:min-w-[240px]">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-0.5 shadow-lg">
                    <div className="w-full h-full bg-slate-900 rounded-[10px] flex items-center justify-center overflow-hidden">
                        {user?.teamLogo ? (
                            <img src={user.teamLogo} alt="Logo" className="w-full h-full object-cover" />
                        ) : (
                            <Shield className="w-5 h-5 text-indigo-400" />
                        )}
                    </div>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        <h3 className="truncate pr-2 font-bold text-white text-base leading-none">{user?.teamName || 'Tak\u0131m \u0130smi'}</h3>
                        <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-[10px] font-medium">
                        <div className="min-w-0">
                            <div className="text-slate-400">Kulüp Bakiyesi</div>
                            <div className="truncate text-slate-200">
                                {loading ? 'Yükleniyor...' : formatClubCurrency(cashBalance)}
                            </div>
                        </div>
                        <div className="min-w-0 text-right">
                            <div className="text-slate-400">Elmas</div>
                            <div className="truncate text-sky-300">{diamondBalance.toLocaleString('tr-TR')}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}




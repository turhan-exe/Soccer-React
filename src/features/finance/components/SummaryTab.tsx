import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FinanceHistoryEntry, ExpectedRevenueBreakdown } from '@/services/finance';
import { formatCurrency } from './FinanceHeader';
import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp } from 'lucide-react';

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
    balance,
    stadiumLevel,
    stadiumCapacity,
    onBuyCredit,
}: SummaryTabProps) {

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Top Section: Finans Durumu */}
            <div>
                <h2 className="text-lg font-bold text-slate-200 mb-3 px-1">Finans Durumu</h2>
                <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide snap-x">

                    {/* Card 1: Mevcut Bakiye */}
                    <div className="snap-center shrink-0 w-[240px] h-[120px] rounded-[24px] bg-[#1a1b2e] border border-white/5 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
                        <div className="p-5 flex flex-col h-full justify-between relative z-10">
                            <div>
                                <p className="text-slate-400 text-xs font-medium mb-1">Mevcut Bakiye</p>
                                <p className="text-2xl font-bold text-white font-mono tracking-tight">{formatCurrency(balance)}</p>
                            </div>
                            <Button
                                size="sm"
                                onClick={onBuyCredit}
                                className="self-end bg-cyan-500 hover:bg-cyan-600 text-white rounded-full px-4 h-8 text-[10px] font-bold uppercase tracking-wide shadow-lg shadow-cyan-500/20"
                            >
                                Bakiye Yükle
                            </Button>
                        </div>
                    </div>

                    {/* Card 2: Stadyum Seviye */}
                    <div className="snap-center shrink-0 w-[200px] h-[120px] rounded-[24px] bg-[#1a1b2e] border border-white/5 relative overflow-hidden">
                        <div className="absolute bottom-0 left-0 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl -ml-10 -mb-10 pointer-events-none" />
                        <div className="p-5 flex flex-col h-full justify-center">
                            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center mb-3 text-purple-400">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M3 21h18" /><path d="M5 21v-7" /><path d="M19 21v-7" /><path d="M5 14a5 5 0 0 1 10 0v7" /><path d="M15 14h4" /></svg>
                            </div>
                            <p className="text-white font-bold text-lg leading-none mb-1">Stadyum Seviye {stadiumLevel}</p>
                            <p className="text-slate-500 text-xs">{stadiumCapacity.toLocaleString('tr-TR')} Koltuk</p>
                        </div>
                    </div>

                    {/* Card 3: Son 30 Gün Net */}
                    <div className="snap-center shrink-0 w-[200px] h-[120px] rounded-[24px] bg-[#1a1b2e] border border-white/5 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl -ml-10 -mt-10 pointer-events-none" />
                        <div className="p-5 flex flex-col h-full justify-center">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-3 ${totals.net >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                {totals.net >= 0 ? <TrendingUp className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                            </div>
                            <p className="text-slate-400 text-xs font-medium mb-1">Son 30 Gün Net</p>
                            <p className={`text-xl font-bold font-mono tracking-tight ${totals.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {totals.net > 0 ? '+' : ''}{formatCurrency(totals.net)}
                            </p>
                        </div>
                    </div>

                </div>
            </div>

            {/* Bottom List Section */}
            <Card className="bg-[#1a1b2e] border-white/5 rounded-[24px] overflow-hidden shadow-xl">
                <CardContent className="p-0">
                    <div className="divide-y divide-white/5">
                        <ListItem label="Toplam Gelir" value={formatCurrency(totals.totalIncome)} valueColor="text-emerald-400" />
                        <ListItem label="Toplam Gider" value={formatCurrency(totals.totalExpense)} valueColor="text-rose-400" />
                        <ListItem label="Net Kâr/Zarar" value={formatCurrency(totals.net)} valueColor={totals.net >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
                        <ListItem label="Ortalama Maç Geliri" value={formatCurrency(averageMatchIncome)} />
                        <ListItem label="Günlük Tahmini Gelir" value={formatCurrency(dailyIncomeEstimate)} />
                    </div>
                </CardContent>
            </Card>

        </div>
    );
}

function ListItem({ label, value, valueColor = 'text-white' }: { label: string, value: string, valueColor?: string }) {
    return (
        <div className="flex items-center justify-between p-5 hover:bg-white/5 transition-colors group">
            <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-slate-700 group-hover:bg-indigo-500 transition-colors" />
                <span className="text-slate-300 font-medium text-sm">{label}</span>
            </div>
            <div className={`font-mono font-bold tracking-tight bg-black/20 px-3 py-1 rounded-lg border border-white/5 ${valueColor}`}>
                {value}
            </div>
        </div>
    )
}

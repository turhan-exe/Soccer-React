import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CreditCard, RefreshCcw, Sparkles } from 'lucide-react';
import { CreditPackage } from '@/services/finance';
import { formatCurrency } from './FinanceHeader';

interface CreditTabProps {
    packages: CreditPackage[];
    loadingId: string | null;
    onPurchase: (pack: CreditPackage) => void;
}

export function CreditTab({
    packages,
    loadingId,
    onPurchase,
}: CreditTabProps) {
    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="mb-6 rounded-xl bg-gradient-to-r from-indigo-900/50 to-purple-900/50 p-6 border border-white/10 text-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10 mb-3">
                    <Sparkles className="h-6 w-6 text-amber-300" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">Kulüp Kredisi Satın Al</h2>
                <p className="text-sm text-indigo-200 max-w-md mx-auto">
                    Krediler ile kulüp bütçenizi anında artırabilir, transferler ve stadyum harcamaları için ek kaynak yaratabilirsiniz.
                </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
                {packages.map((pack) => (
                    <Card key={pack.id} className="relative border-white/5 bg-slate-900/60 backdrop-blur-sm shadow-xl hover:border-indigo-500/50 transition-colors group overflow-hidden">
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-100 transition-opacity">
                            <Sparkles className="h-12 w-12 text-indigo-500" />
                        </div>

                        <CardContent className="p-6 flex flex-col items-center text-center h-full justify-between">
                            <div>
                                <p className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 font-mono tracking-tighter">
                                    {formatCurrency(pack.amount).replace('$', '')}
                                </p>
                                <p className="text-xs uppercase tracking-widest text-emerald-400 font-bold mt-1">Kredi</p>
                            </div>

                            <div className="mt-8 w-full space-y-3">
                                <div className="text-lg font-bold text-white bg-white/5 py-2 rounded-lg border border-white/5">
                                    ${pack.price.toFixed(2)}
                                </div>
                                <Button
                                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                                    onClick={() => onPurchase(pack)}
                                    disabled={loadingId === pack.id}
                                >
                                    {loadingId === pack.id && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
                                    SATIN AL
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Shirt } from 'lucide-react';
import { TeamSalariesDoc, TeamSalaryRecord } from '@/services/finance';
import { formatCurrency } from './FinanceHeader';

interface SalaryTabProps {
    salaries: TeamSalariesDoc | null;
}

export function SalaryTab({ salaries }: SalaryTabProps) {
    return (
        <Card className="border-white/5 bg-slate-900/60 backdrop-blur-sm shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <CardHeader className="bg-slate-950/50 border-b border-white/5 pb-4">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-white/90 text-sm uppercase tracking-wider">
                        <Users className="h-4 w-4 text-cyan-400" />
                        Maaş Listesi
                    </CardTitle>
                    <div className="text-right">
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest">Aylık Toplam</p>
                        <p className="text-lg font-bold text-rose-400 font-mono tracking-tight">{formatCurrency(salaries?.total ?? 0)}</p>
                    </div>
                </div>
            </CardHeader>

            <div className="p-0">
                <ScrollArea className="h-[500px]">
                    <Table>
                        <TableHeader className="bg-white/5 sticky top-0 z-10 backdrop-blur-sm">
                            <TableRow className="border-white/5 hover:bg-transparent">
                                <TableHead className="text-xs uppercase tracking-wider text-slate-400">Oyuncu</TableHead>
                                <TableHead className="text-xs uppercase tracking-wider text-slate-400 text-center">Mevki</TableHead>
                                <TableHead className="text-xs uppercase tracking-wider text-slate-400 text-center">Güç</TableHead>
                                <TableHead className="text-xs uppercase tracking-wider text-slate-400 text-right">Maaş</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {salaries?.players.map((record: TeamSalaryRecord) => {
                                // Normalize overall to 0-100 if it's in 0-1 range
                                const displayOverall = record.overall <= 1 ? Math.round(record.overall * 100) : Math.round(record.overall);

                                return (
                                    <TableRow key={record.playerId} className="border-white/5 hover:bg-white/5 transition-colors">
                                        <TableCell className="font-medium text-slate-200">
                                            <div className="flex items-center gap-2">
                                                <div className="h-6 w-6 rounded-full bg-slate-800 flex items-center justify-center">
                                                    <Shirt className="h-3 w-3 text-slate-400" />
                                                </div>
                                                {record.name}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center text-xs text-slate-400">{record.position}</TableCell>
                                        <TableCell className="text-center">
                                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold ${getOverallColor(displayOverall)}`}>
                                                {displayOverall}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-slate-300">{formatCurrency(record.salary)}</TableCell>
                                    </TableRow>
                                )
                            })}
                            {!salaries && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-sm text-slate-500 py-8">
                                        Maaş verisi hesaplanıyor veya mevcut değil.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </div>

            <div className="p-4 border-t border-white/5 bg-rose-500/5">
                <p className="text-xs text-rose-300/80 text-center">
                    * Oyuncu maaşları yetenek seviyelerine (Overall) göre otomatik belirlenmektedir.
                </p>
            </div>
        </Card>
    );
}

function getOverallColor(rating: number) {
    if (rating >= 80) return 'bg-amber-500/20 text-amber-400';
    if (rating >= 70) return 'bg-emerald-500/20 text-emerald-400';
    return 'bg-slate-500/20 text-slate-400';
}

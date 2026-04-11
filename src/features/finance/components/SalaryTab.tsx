import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslation } from '@/contexts/LanguageContext';
import { Users, Shirt } from 'lucide-react';
import type { TeamSalariesDoc, TeamSalaryRecord } from '@/services/finance';
import { getPositionShortLabel } from '@/lib/positionLabels';
import { formatCurrency } from './FinanceHeader';

interface SalaryTabProps {
  salaries: TeamSalariesDoc | null;
}

export function SalaryTab({ salaries }: SalaryTabProps) {
  const { t } = useTranslation();

  return (
    <Card className="animate-in overflow-hidden border-white/5 bg-slate-900/60 shadow-xl backdrop-blur-sm fade-in slide-in-from-bottom-4 duration-500">
      <CardHeader className="border-b border-white/5 bg-slate-950/50 pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-white/90">
            <Users className="h-4 w-4 text-cyan-400" />
            {t('finance.salaries.title')}
          </CardTitle>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-slate-400">
              {t('finance.salaries.monthlyTotal')}
            </p>
            <p className="font-mono text-lg font-bold tracking-tight text-rose-400">
              {formatCurrency(salaries?.total ?? 0)}
            </p>
          </div>
        </div>
      </CardHeader>

      <div className="p-0">
        <ScrollArea className="h-[500px]">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-white/5 backdrop-blur-sm">
              <TableRow className="border-white/5 hover:bg-transparent">
                <TableHead className="text-xs uppercase tracking-wider text-slate-400">
                  {t('finance.salaries.player')}
                </TableHead>
                <TableHead className="text-center text-xs uppercase tracking-wider text-slate-400">
                  {t('finance.salaries.position')}
                </TableHead>
                <TableHead className="text-center text-xs uppercase tracking-wider text-slate-400">
                  {t('finance.salaries.power')}
                </TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-slate-400">
                  {t('finance.salaries.salary')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {salaries?.players.map((record: TeamSalaryRecord) => {
                const displayOverall =
                  record.overall <= 1 ? Math.round(record.overall * 100) : Math.round(record.overall);

                return (
                  <TableRow key={record.playerId} className="border-white/5 transition-colors hover:bg-white/5">
                    <TableCell className="font-medium text-slate-200">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800">
                          <Shirt className="h-3 w-3 text-slate-400" />
                        </div>
                        {record.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-xs text-slate-400">
                      {getPositionShortLabel(record.position)}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-[10px] font-bold ${getOverallColor(displayOverall)}`}>
                        {displayOverall}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-slate-300">
                      {formatCurrency(record.salary)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!salaries && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-500">
                    {t('finance.salaries.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      <div className="border-t border-white/5 bg-rose-500/5 p-4">
        <p className="text-center text-xs text-rose-300/80">{t('finance.salaries.footnote')}</p>
      </div>
    </Card>
  );
}

function getOverallColor(rating: number) {
  if (rating >= 80) return 'bg-amber-500/20 text-amber-400';
  if (rating >= 70) return 'bg-emerald-500/20 text-emerald-400';
  return 'bg-slate-500/20 text-slate-400';
}

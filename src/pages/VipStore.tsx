import React, { useMemo, useState } from 'react';
import { Crown, Loader2, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BackButton } from '@/components/ui/back-button';
import { useInventory, type VipPlan, type VipPlanConfig } from '@/contexts/InventoryContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useAuth } from '@/contexts/AuthContext';

const formatDate = (value: string | null): string => {
  if (!value) {
    return 'Belirlenmedi';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Belirlenmedi';
  }
  return parsed.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const VipStorePage: React.FC = () => {
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const { vipPlans, activateVip, vipStatus, vipActive, isHydrated } = useInventory();
  const [pendingPlan, setPendingPlan] = useState<VipPlan | null>(null);

  type VipPlanEntry = [VipPlan, VipPlanConfig];
  const planEntries = useMemo(() => Object.entries(vipPlans) as VipPlanEntry[], [vipPlans]);

  const handlePurchase = async (plan: VipPlan) => {
    if (pendingPlan) {
      return;
    }
    setPendingPlan(plan);
    try {
      await activateVip(plan);
    } finally {
      setPendingPlan(null);
    }
  };

  const canInteract = Boolean(user) && isHydrated && !pendingPlan;
  const activePlanLabel = vipStatus.plan ? vipPlans[vipStatus.plan].label : 'Aktif VIP yok';

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-15%] top-[-10%] h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="absolute right-[-30%] bottom-[-20%] h-[28rem] w-[28rem] rounded-full bg-cyan-400/10 blur-3xl" />
      </div>
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col gap-8 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold text-white">VIP Paketleri</h1>
              <p className="mt-1 text-sm text-slate-300">
                Haftalik, aylik veya yillik paketlerden birini secerek kulubune premium avantajlar ekle.
              </p>
            </div>
          </div>
          <Badge
            variant={vipActive ? 'secondary' : 'outline'}
            className={vipActive ? 'border-amber-200/40 bg-amber-500/20 text-amber-100' : 'border-white/20 text-slate-200'}
          >
            Bakiye: {balance} elmas
          </Badge>
        </div>

        <Card className="border-white/10 bg-slate-900/60 backdrop-blur-lg">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-xl text-white">
              <Crown className={`h-5 w-5 ${vipActive ? 'text-amber-300' : 'text-slate-400'}`} />
              VIP Durumu
            </CardTitle>
            {vipActive ? (
              <Badge className="border-emerald-300/40 bg-emerald-500/20 text-emerald-100">
                Aktif
              </Badge>
            ) : (
              <Badge variant="outline" className="border-white/20 text-slate-200">
                Pasif
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-300">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Paket</p>
                <p className="text-base font-semibold text-emerald-200">{activePlanLabel}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">VIP Bitis</p>
                <p className="text-base font-semibold text-emerald-200">{formatDate(vipStatus.expiresAt)}</p>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Ayricaliklar</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                <li>Gunluk +1 enerji, moral ve saglik kiti</li>
                <li>%5 antrenman ve sure kisalmasi</li>
                <li>Her ay 1 yildiz oyuncu karti</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-3">
          {planEntries.map(([plan, config]) => {
            const isProcessing = pendingPlan === plan;
            return (
              <Card
                key={plan}
                className="group flex flex-col border-white/10 bg-slate-900/60 transition hover:border-emerald-300/40 hover:shadow-lg hover:shadow-emerald-500/10"
              >
                <CardHeader className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-300" />
                    <CardTitle className="text-lg text-white">{config.label}</CardTitle>
                  </div>
                  <p className="text-sm text-slate-300">{config.description}</p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-between gap-4">
                  <div className="space-y-4 text-sm text-slate-300">
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Sure</p>
                      <p className="text-lg font-semibold text-emerald-200">{config.durationDays} gun</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">Faydalar</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {config.perks.map((perk) => (
                          <li key={perk}>{perk}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={() => handlePurchase(plan)}
                      disabled={!canInteract}
                      className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Satin aliniyor
                        </>
                      ) : (
                        <>
                          {config.diamondCost} elmas
                        </>
                      )}
                    </Button>
                    <p className="text-center text-xs text-slate-400">
                      VIP gunluk bonuslari otomatik olarak envanterine eklenir.
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default VipStorePage;

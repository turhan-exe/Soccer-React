import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  NegotiationAttempt,
  NegotiationStartPayload,
  startNegotiationAttempt,
  submitNegotiationOffer,
  type NegotiationOffer,
} from '@/services/negotiation';
import { RefreshCcw } from 'lucide-react';

export interface NegotiationContext {
  playerId: string;
  playerName: string;
  overall: number;
  transferFee?: number;
  source: NegotiationStartPayload['source'];
  position?: string;
  contextId: string;
}

interface NegotiationDialogProps {
  open: boolean;
  context: NegotiationContext | null;
  onClose: () => void;
  onAccepted: (payload: { salary: number; attempt: NegotiationAttempt }) => Promise<void> | void;
  onRejected?: (payload: { attempt: NegotiationAttempt }) => Promise<void> | void;
}

type OfferStatus = 'idle' | 'submitting';

const isPermissionError = (error: unknown): boolean =>
  error instanceof Error && error.message.toLowerCase().includes('missing or insufficient permissions');

export function NegotiationDialog({ open, context, onClose, onAccepted, onRejected }: NegotiationDialogProps) {
  const { user } = useAuth();
  const [attempt, setAttempt] = useState<NegotiationAttempt | null>(null);
  const [offers, setOffers] = useState<NegotiationOffer[]>([]);
  const [patienceLeft, setPatienceLeft] = useState<number>(3);
  const [offerValue, setOfferValue] = useState('');
  const [status, setStatus] = useState<OfferStatus>('idle');
  const [baseSalary, setBaseSalary] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setAttempt(null);
      setOffers([]);
      setOfferValue('');
      setPatienceLeft(3);
      setBaseSalary(null);
      setStatus('idle');
      return;
    }

    let active = true;
    if (user && context) {
      if (!context.contextId) {
        toast.error('Pazarlik bilgisi eksik.');
        onClose();
        return;
      }
      const payload: NegotiationStartPayload = {
        playerId: context.playerId,
        playerName: context.playerName,
        overall: context.overall,
        transferFee: context.transferFee,
        source: context.source,
        contextId: context.contextId,
      };
      startNegotiationAttempt(user.id, payload)
        .then((started) => {
          if (!active) return;
          setAttempt(started);
          setOffers([]);
          setPatienceLeft(started.patienceLeft ?? 3);
          setBaseSalary(started.baseSalary);
        })
        .catch((err) => {
          console.error('[NegotiationDialog] failed to start negotiation', err);
          if (isPermissionError(err)) {
            toast.error('Yetki hatasi', {
              description: 'Pazarlik baslatmak icin gerekli iznin yok.',
            });
          } else {
            toast.error(err instanceof Error ? err.message : 'Pazarlik baslatilamadi');
          }
          onClose();
        });
    }

    return () => {
      active = false;
    };
  }, [open, user, context, onClose]);

  const patiencePercent = useMemo(() => Math.max(0, Math.min(100, (patienceLeft / 3) * 100)), [patienceLeft]);

  const handleSubmitOffer = async () => {
    if (!attempt || !user) return;
    const amount = Number(offerValue);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Lutfen gecerli bir maas teklifi gir.');
      return;
    }

    setStatus('submitting');
    try {
      const result = await submitNegotiationOffer(user.id, attempt.id, amount);
      setOffers(result.offers);
      setPatienceLeft(result.patienceLeft);
      setBaseSalary(result.baseSalary);
      setOfferValue('');

      if (result.status === 'accepted') {
        const updatedAttempt: NegotiationAttempt = {
          ...attempt,
          offerHistory: result.offers,
          patienceLeft: result.patienceLeft,
          accepted: true,
          rejected: false,
        };
        setAttempt(updatedAttempt);
        await onAccepted({ salary: amount, attempt: updatedAttempt });
        onClose();
      } else if (result.status === 'rejected') {
        const updatedAttempt: NegotiationAttempt = {
          ...attempt,
          offerHistory: result.offers,
          patienceLeft: result.patienceLeft,
          accepted: false,
          rejected: true,
        };
        setAttempt(updatedAttempt);
        await onRejected?.({ attempt: updatedAttempt });
        toast.error('Oyuncu pazarligi reddetti.');
        onClose();
      }
    } catch (err) {
      console.error('[NegotiationDialog] offer failed', err);
      if (isPermissionError(err)) {
        toast.error('Yetki hatasi', {
          description: 'Teklif gondermek icin gerekli iznin yok.',
        });
      } else {
        toast.error(err instanceof Error ? err.message : 'Teklif gonderilemedi');
      }
    } finally {
      setStatus('idle');
    }
  };

  const handleCancel = async () => {
    if (attempt) {
      await onRejected?.({ attempt });
    }
    onClose();
  };

  const disabled = !attempt || !user || status === 'submitting';
  const targetSalary = baseSalary ?? (context ? Math.round(context.overall * 150) : 0);

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? handleCancel() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Maas Pazarligi</DialogTitle>
          <DialogDescription>
            Oyuncu {targetSalary.toLocaleString('tr-TR')} $ maas talep ediyor. Toplam {patienceLeft} teklif hakkin kaldi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-slate-300">
              <strong>{context?.playerName}</strong> ({context?.position ?? 'N/A'}) - Overall {context?.overall ?? 0}
            </p>
            {context?.transferFee !== undefined && (
              <p className="text-xs text-slate-400">Transfer ucreti: {formatCurrency(context.transferFee)}</p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Sabir</p>
            <Progress value={patiencePercent} className="mt-2 h-2 bg-white/10" />
          </div>

          <div>
            <p className="text-sm text-slate-300">Maas teklifin</p>
            <div className="mt-2 flex items-center gap-3">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={offerValue}
                onChange={(event) => setOfferValue(event.target.value)}
                disabled={disabled || patienceLeft <= 0}
                placeholder={targetSalary.toString()}
              />
              <Button onClick={handleSubmitOffer} disabled={disabled || patienceLeft <= 0}>
                {status === 'submitting' && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
                Teklif Gonder
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Oyuncu teklifin {targetSalary.toLocaleString('tr-TR')} $ ve uzerinde olmasini bekliyor.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-white">Teklif Gecmisi</p>
            <div className="mt-2 space-y-2 rounded-xl border border-white/10 p-3">
              {offers.length === 0 && <p className="text-xs text-slate-400">Henuz teklif yapilmadi.</p>}
              {offers.map((offer) => (
                <OfferRow key={offer.createdAt.toMillis()} offer={offer} />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex justify-between">
          <Button variant="outline" onClick={handleCancel} disabled={status === 'submitting'}>
            Vazgec
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OfferRow({ offer }: { offer: NegotiationOffer }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{offer.amount.toLocaleString('tr-TR')} $</span>
      <span className={offer.accepted ? 'text-emerald-300' : 'text-slate-400'}>
        {offer.accepted ? 'Kabul edildi' : 'Reddedildi'}
      </span>
    </div>
  );
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(value));


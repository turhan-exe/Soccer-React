import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { clampNumber, formatSalary, type SalaryNegotiationProfile } from '@/lib/contractNegotiation';
import type { Player } from '@/types';

type SalaryNegotiationDialogProps = {
  player: Player | null;
  profile: SalaryNegotiationProfile | null;
  offer: number;
  confidence: number;
  minOffer: number;
  isSubmitting: boolean;
  attempt: number;
  maxAttempts: number;
  counterOffer: number | null;
  isFinalCounter: boolean;
  isLocked: boolean;
  onOfferChange: (value: number) => void;
  onClose: () => void;
  onSubmit: () => void;
  onAcceptCounter: () => void;
  onRejectCounter: () => void;
};

export function SalaryNegotiationDialog({
  player,
  profile,
  offer,
  confidence,
  minOffer,
  isSubmitting,
  attempt,
  maxAttempts,
  counterOffer,
  isFinalCounter,
  isLocked,
  onOfferChange,
  onClose,
  onSubmit,
  onAcceptCounter,
  onRejectCounter,
}: SalaryNegotiationDialogProps) {
  return (
    <Dialog open={Boolean(player)} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg w-[min(92vw,520px)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Maaş Pazarlığı</DialogTitle>
          <DialogDescription>
            {player ? `${player.name} ile yeni maaş teklifi üzerinde çalışılıyor.` : 'Bir oyuncu seçin.'}
          </DialogDescription>
        </DialogHeader>
        {profile && player ? (
          <div className="space-y-3">
            <div className="rounded-md border border-muted bg-muted/40 p-3 text-sm space-y-1">
              <p>Güncel maaş: {formatSalary(profile.baseSalary)}</p>
              <p>Oyuncunun beklentisi: {formatSalary(profile.demand)}</p>
              <p>Kalan hak: {Math.max(maxAttempts - attempt, 0)}</p>
              <p>
                Aralık: {formatSalary(minOffer)} – {formatSalary(profile.ceiling)}
              </p>
            </div>
            {counterOffer !== null ? (
              <div className="rounded-md border border-amber-300/40 bg-amber-50 p-3 text-sm text-amber-900">
                <p>Oyuncunun karşı teklifi: {formatSalary(counterOffer)}</p>
                <p className="text-xs">
                  {isFinalCounter
                    ? 'Bu son teklif. Kabul edebilir veya reddedebilirsin.'
                    : 'Teklifini güncelleyerek pazarlığa devam edebilirsin.'}
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Teklifiniz</span>
                <span>{formatSalary(offer)}</span>
              </div>
              <Slider
                min={minOffer}
                max={profile.ceiling}
                step={25}
                value={[offer]}
                disabled={isLocked}
                onValueChange={value => {
                  const next = Number(value?.[0] ?? 0);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  onOfferChange(next);
                }}
              />
              <Input
                type="number"
                value={offer}
                min={minOffer}
                max={profile.ceiling}
                disabled={isLocked}
                onChange={event => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  onOfferChange(clampNumber(Math.round(next), minOffer, profile.ceiling));
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Tahmini kabul şansı: %{Math.round(confidence * 100)}
            </p>
            <p className="text-xs text-muted-foreground">{profile.narrative}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Oyuncu bilgisi yükleniyor.</p>
        )}
        {isFinalCounter ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={isSubmitting} onClick={onRejectCounter}>
              Reddet
            </Button>
            <Button disabled={isSubmitting || !profile} onClick={onAcceptCounter}>
              Karşı Teklifi Kabul Et
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>
              Vazgeç
            </Button>
            <Button disabled={isSubmitting || !profile || !Number.isFinite(offer) || isLocked} onClick={onSubmit}>
              Teklifi Gönder
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
import React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { useTranslation } from '@/contexts/LanguageContext';
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
  const { t } = useTranslation();

  return (
    <Dialog open={Boolean(player)} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg w-[min(92vw,520px)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('teamPlanning.salaryDialog.title')}</DialogTitle>
          <DialogDescription>
            {player
              ? t('teamPlanning.salaryDialog.subtitleWithName', { name: player.name })
              : t('teamPlanning.salaryDialog.subtitleFallback')}
          </DialogDescription>
        </DialogHeader>
        {profile && player ? (
          <div className="space-y-3">
            <div className="space-y-1 rounded-md border border-muted bg-muted/40 p-3 text-sm">
              <p>{t('teamPlanning.salaryDialog.currentSalary', { value: formatSalary(profile.baseSalary) })}</p>
              <p>{t('teamPlanning.salaryDialog.expectedSalary', { value: formatSalary(profile.demand) })}</p>
              <p>{t('teamPlanning.salaryDialog.attemptsLeft', { value: Math.max(maxAttempts - attempt, 0) })}</p>
              <p>
                {t('teamPlanning.salaryDialog.range', {
                  min: formatSalary(minOffer),
                  max: formatSalary(profile.ceiling),
                })}
              </p>
            </div>
            {counterOffer !== null ? (
              <div className="rounded-md border border-amber-300/40 bg-amber-50 p-3 text-sm text-amber-900">
                <p>{t('teamPlanning.salaryDialog.counterOffer', { value: formatSalary(counterOffer) })}</p>
                <p className="text-xs">
                  {isFinalCounter
                    ? t('teamPlanning.salaryDialog.finalCounter')
                    : t('teamPlanning.salaryDialog.continueCounter')}
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{t('teamPlanning.salaryDialog.yourOffer')}</span>
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
              {t('teamPlanning.salaryDialog.acceptanceChance', {
                value: Math.round(confidence * 100),
              })}
            </p>
            <p className="text-xs text-muted-foreground">{profile.narrative}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('teamPlanning.salaryDialog.loading')}</p>
        )}
        {isFinalCounter ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={isSubmitting} onClick={onRejectCounter}>
              {t('teamPlanning.salaryDialog.reject')}
            </Button>
            <Button disabled={isSubmitting || !profile} onClick={onAcceptCounter}>
              {t('teamPlanning.salaryDialog.acceptCounter')}
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>
              {t('teamPlanning.salaryDialog.cancel')}
            </Button>
            <Button disabled={isSubmitting || !profile || !Number.isFinite(offer) || isLocked} onClick={onSubmit}>
              {t('teamPlanning.salaryDialog.submit')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

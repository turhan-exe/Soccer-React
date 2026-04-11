import React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/contexts/LanguageContext';
import type { Player } from '@/types';

type RenamePlayerDialogProps = {
  player: Player | null;
  renameInput: string;
  balance: number;
  diamondCost: number;
  adCooldownHours: number;
  isAdAvailable: boolean;
  adAvailableAt: Date | null;
  isRenaming: boolean;
  onClose: () => void;
  onChangeInput: (value: string) => void;
  onRenameWithAd: () => void;
  onRenameWithPurchase: () => void;
};

export function RenamePlayerDialog({
  player,
  renameInput,
  balance,
  diamondCost,
  adCooldownHours,
  isAdAvailable,
  adAvailableAt,
  isRenaming,
  onClose,
  onChangeInput,
  onRenameWithAd,
  onRenameWithPurchase,
}: RenamePlayerDialogProps) {
  const { t, formatDate } = useTranslation();

  return (
    <Dialog open={Boolean(player)} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('teamPlanning.renameDialog.title')}</DialogTitle>
          <DialogDescription>
            {player
              ? t('teamPlanning.renameDialog.subtitleWithName', { name: player.name })
              : t('teamPlanning.renameDialog.subtitleFallback')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={renameInput}
            onChange={event => onChangeInput(event.target.value)}
            placeholder={t('teamPlanning.renameDialog.placeholder')}
            disabled={isRenaming}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            {t('teamPlanning.renameDialog.help', {
              hours: adCooldownHours,
              diamonds: diamondCost,
              balance,
            })}
          </p>
          {!isAdAvailable && adAvailableAt && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('teamPlanning.renameDialog.adRefreshAt', {
                date: formatDate(adAvailableAt, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={!isAdAvailable || isRenaming} onClick={onRenameWithAd}>
            {t('teamPlanning.renameDialog.adAction')}
          </Button>
          <Button disabled={isRenaming} onClick={onRenameWithPurchase}>
            {t('teamPlanning.renameDialog.purchaseAction', { diamonds: diamondCost })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

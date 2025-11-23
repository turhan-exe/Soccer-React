import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
  return (
    <Dialog open={Boolean(player)} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Oyuncu Adını Özelleştir</DialogTitle>
          <DialogDescription>
            {player ? `${player.name} için yeni bir isim belirleyin.` : 'Oyuncu adını güncelleyin.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={renameInput}
            onChange={event => onChangeInput(event.target.value)}
            placeholder="Yeni oyuncu adı"
            disabled={isRenaming}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Reklam seçeneği {adCooldownHours} saatte bir kullanılabilir. Elmas seçeneği {diamondCost} elmas
            harcar. Bakiyeniz: {balance}
          </p>
          {!isAdAvailable && adAvailableAt && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Bir sonraki reklam hakkı {adAvailableAt.toLocaleString('tr-TR')} tarihinde yenilenecek.
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={!isAdAvailable || isRenaming} onClick={onRenameWithAd}>
            Reklam İzle ve Aç
          </Button>
          <Button disabled={isRenaming} onClick={onRenameWithPurchase}>
            {diamondCost} Elmasla Onayla
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

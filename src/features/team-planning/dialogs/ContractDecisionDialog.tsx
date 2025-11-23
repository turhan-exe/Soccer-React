import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatContractCountdown } from '@/lib/contracts';
import { getLegendIdFromPlayer } from '@/services/legends';
import type { Player } from '@/types';
import { getContractExpiration } from '@/features/team-planning/teamPlanningUtils';

type ContractDecisionDialogProps = {
  player: Player | null;
  teamLeagueId: string | null;
  isProcessing: boolean;
  onRelease: () => void;
  onExtend: () => void;
};

export function ContractDecisionDialog({
  player,
  teamLeagueId,
  isProcessing,
  onRelease,
  onExtend,
}: ContractDecisionDialogProps) {
  const isLegendRental = player ? getLegendIdFromPlayer(player) !== null : false;

  return (
    <Dialog open={Boolean(player)} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Sözleşme Yenileme Kararı</DialogTitle>
          <DialogDescription>
            {player ? `${player.name} için sözleşme süresi doldu.` : 'Sözleşme süresi dolan oyuncu bulunamadı.'}
          </DialogDescription>
        </DialogHeader>
        {player ? (
          <div className="space-y-3">
            <div className="rounded-md border border-muted bg-muted/40 p-3 text-sm">
              <p>{formatContractCountdown(getContractExpiration(player), teamLeagueId)}</p>
              <p>Mevcut Rol: {player.squadRole}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {isLegendRental
                ? 'Bu nostalji efsanesinin sözleşmesi uzatılamaz. Süre dolduğunda oyuncu otomatik olarak kulüpten ayrılır.'
                : 'Sözleşmeyi uzatırsanız oyuncu takımda kalmaya devam eder. Aksi halde serbest bırakılarak transfer listesine düşer.'}
            </p>
          </div>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {player ? (
            <Button variant="secondary" disabled={isProcessing} onClick={onRelease}>
              Serbest Bırak
            </Button>
          ) : null}
          {player && !isLegendRental ? (
            <Button disabled={isProcessing} onClick={onExtend}>
              Sözleşmeyi Uzat
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

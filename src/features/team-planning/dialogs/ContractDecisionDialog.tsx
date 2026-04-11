import React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTranslation } from '@/contexts/LanguageContext';
import { formatContractCountdown } from '@/lib/contracts';
import { getContractExpiration } from '@/features/team-planning/teamPlanningUtils';
import { getLegendIdFromPlayer } from '@/services/legends';
import type { Player } from '@/types';

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
  const { t } = useTranslation();
  const isLegendRental = player ? getLegendIdFromPlayer(player) !== null : false;

  return (
    <Dialog open={Boolean(player)} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('teamPlanning.contractDecision.title')}</DialogTitle>
          <DialogDescription>
            {player
              ? t('teamPlanning.contractDecision.expiredFor', { name: player.name })
              : t('teamPlanning.contractDecision.missingPlayer')}
          </DialogDescription>
        </DialogHeader>

        {player ? (
          <div className="space-y-3">
            <div className="rounded-md border border-muted bg-muted/40 p-3 text-sm">
              <p>{formatContractCountdown(getContractExpiration(player), teamLeagueId)}</p>
              <p>
                {t('teamPlanning.contractDecision.currentRole', {
                  role: t(`common.squadRoles.${player.squadRole}`),
                })}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {isLegendRental
                ? t('teamPlanning.contractDecision.legendRental')
                : t('teamPlanning.contractDecision.regularPlayer')}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {player ? (
            <Button variant="secondary" disabled={isProcessing} onClick={onRelease}>
              {t('teamPlanning.contractDecision.release')}
            </Button>
          ) : null}
          {player && !isLegendRental ? (
            <Button disabled={isProcessing} onClick={onExtend}>
              {t('teamPlanning.contractDecision.extend')}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

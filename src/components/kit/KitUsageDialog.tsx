import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import { useInventory } from '@/contexts/InventoryContext';
import type { KitType, Player } from '@/types';
import { KIT_CONFIG, formatKitEffect } from '@/lib/kits';
import { formatRatingLabel } from '@/lib/player';
import { toGaugePercentage } from '@/lib/playerVitals';
import { getTeam } from '@/services/team';

type KitUsageDialogProps = {
  open: boolean;
  kitType: KitType | null;
  onOpenChange: (open: boolean) => void;
  playerId?: string | null;
  onApplied?: (player: Player) => void;
};

const normalizePlayers = (players: Player[]): Player[] =>
  players.map((player) => ({ ...player, injuryStatus: player.injuryStatus ?? 'healthy' }));

const AVAILABLE_KIT_TYPES = Object.keys(KIT_CONFIG) as KitType[];

const KitUsageDialog = ({
  open,
  kitType,
  onOpenChange,
  playerId = null,
  onApplied,
}: KitUsageDialogProps) => {
  const { user } = useAuth();
  const { kits, applyKitToPlayer, isProcessing } = useInventory();
  const [search, setSearch] = useState('');
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const isPlayerLockedMode = Boolean(playerId);

  const { data: players = [], isLoading, refetch } = useQuery({
    queryKey: ['team-players', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const team = await getTeam(user.id);
      if (!team?.players) return [];
      return normalizePlayers(team.players);
    },
    enabled: open && Boolean(user) && (Boolean(kitType) || Boolean(playerId)),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSubmittingKey(null);
    }
  }, [open]);

  const lockedPlayer = useMemo(() => {
    if (!playerId) return null;
    return players.find((player) => String(player.id) === String(playerId)) ?? null;
  }, [playerId, players]);

  const filteredPlayers = useMemo(() => {
    if (!kitType) return [];
    const term = search.trim().toLowerCase();

    const list = players.filter((player) =>
      term.length === 0 ? true : player.name.toLowerCase().includes(term),
    );

    const byHealth = (value: Player) => toGaugePercentage(value.health, 1);
    const byCondition = (value: Player) => toGaugePercentage(value.condition);
    const byMotivation = (value: Player) => toGaugePercentage(value.motivation);

    return list.sort((a, b) => {
      if (kitType === 'health') {
        const aInjured = a.injuryStatus === 'injured' ? 0 : 1;
        const bInjured = b.injuryStatus === 'injured' ? 0 : 1;
        if (aInjured !== bInjured) {
          return aInjured - bInjured;
        }
        return byHealth(a) - byHealth(b);
      }

      if (kitType === 'energy') {
        return byCondition(a) - byCondition(b);
      }

      return byMotivation(a) - byMotivation(b);
    });
  }, [players, search, kitType]);

  const handleApply = async (selectedKitType: KitType, targetPlayerId: string) => {
    const nextSubmittingKey = `${selectedKitType}:${targetPlayerId}`;
    setSubmittingKey(nextSubmittingKey);
    try {
      await applyKitToPlayer(selectedKitType, targetPlayerId);
      const refreshed = await refetch();
      const refreshedPlayers = normalizePlayers(refreshed.data ?? players);
      const updatedPlayer =
        refreshedPlayers.find((player) => String(player.id) === String(targetPlayerId)) ?? null;

      if (updatedPlayer) {
        onApplied?.(updatedPlayer);
      }

      if (!isPlayerLockedMode) {
        onOpenChange(false);
      }
    } catch (error) {
      console.warn('[KitUsageDialog] apply kit failed', error);
    } finally {
      setSubmittingKey(null);
    }
  };

  const activeConfig = kitType ? KIT_CONFIG[kitType] : null;
  const remaining = kitType ? kits[kitType] ?? 0 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isPlayerLockedMode
              ? 'Kitleri Kullan'
              : kitType
                ? `${activeConfig?.label} Kullan`
                : 'Kit Sec'}
          </DialogTitle>
          {isPlayerLockedMode ? (
            <DialogDescription className="space-y-1">
              <span>
                {lockedPlayer
                  ? `${lockedPlayer.name} icin uygun kiti sec ve uygula.`
                  : 'Secili oyuncu yukleniyor.'}
              </span>
            </DialogDescription>
          ) : kitType ? (
            <DialogDescription className="space-y-1">
              <span>{activeConfig?.description}</span>
              <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {formatKitEffect(kitType)}
              </div>
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {!isPlayerLockedMode && !kitType && (
          <p className="py-6 text-sm text-muted-foreground">
            Lutfen once kullanmak istediginiz kiti secin.
          </p>
        )}

        {isPlayerLockedMode && (
          <div className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Oyuncu bilgileri yukleniyor...
              </div>
            ) : !lockedPlayer ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Secili oyuncu bulunamadi.
              </div>
            ) : (
              <>
                <div className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">{lockedPlayer.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {lockedPlayer.position} - Guc {formatRatingLabel(lockedPlayer.overall)}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Badge variant="outline">Yas {lockedPlayer.age}</Badge>
                        {lockedPlayer.injuryStatus === 'injured' && (
                          <Badge variant="destructive">Sakat</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">
                        Saglik %{toGaugePercentage(lockedPlayer.health, 1)}
                      </div>
                      <Progress
                        value={toGaugePercentage(lockedPlayer.health, 1)}
                        className="h-2"
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">
                        Kondisyon %{toGaugePercentage(lockedPlayer.condition)}
                      </div>
                      <Progress
                        value={toGaugePercentage(lockedPlayer.condition)}
                        className="h-2"
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">
                        Motivasyon %{toGaugePercentage(lockedPlayer.motivation)}
                      </div>
                      <Progress
                        value={toGaugePercentage(lockedPlayer.motivation)}
                        className="h-2"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {AVAILABLE_KIT_TYPES.map((availableKitType) => {
                    const config = KIT_CONFIG[availableKitType];
                    const availableCount = kits[availableKitType] ?? 0;
                    const isSubmitting =
                      submittingKey === `${availableKitType}:${lockedPlayer.id}` && isProcessing;

                    return (
                      <div
                        key={availableKitType}
                        className="rounded-lg border bg-card p-4 shadow-sm transition hover:border-primary/40"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-semibold">{config.label}</div>
                              <Badge variant={availableCount > 0 ? 'secondary' : 'outline'}>
                                {availableCount}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {config.description}
                            </div>
                            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              {formatKitEffect(availableKitType)}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            disabled={availableCount === 0 || isProcessing}
                            onClick={() => handleApply(availableKitType, lockedPlayer.id)}
                          >
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {availableCount === 0 ? 'Stok Yok' : 'Kullan'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {!isPlayerLockedMode && kitType && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span>Kalan stok:</span>
              <Badge variant={remaining > 0 ? 'secondary' : 'outline'}>{remaining}</Badge>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Oyuncu ara"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>

            <ScrollArea className="max-h-80 pr-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Oyuncular yukleniyor...
                </div>
              ) : filteredPlayers.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Uygun oyuncu bulunamadi.
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPlayers.map((player) => {
                    const health = toGaugePercentage(player.health, 1);
                    const condition = toGaugePercentage(player.condition);
                    const motivation = toGaugePercentage(player.motivation);
                    const isSubmitting =
                      submittingKey === `${kitType}:${player.id}` && isProcessing;

                    return (
                      <div
                        key={player.id}
                        className="rounded-lg border bg-card p-3 shadow-sm transition hover:border-primary/40"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <div className="text-sm font-semibold">{player.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {player.position} - Saglik %{health} - Kondisyon %{condition} -
                              {' '}Motivasyon %{motivation}
                            </div>
                            <div className="flex flex-wrap gap-2 pt-1">
                              <Badge variant="outline">
                                Guc {formatRatingLabel(player.overall)}
                              </Badge>
                              {player.injuryStatus === 'injured' && (
                                <Badge variant="destructive">Sakat</Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            disabled={remaining === 0 || isProcessing}
                            onClick={() => handleApply(kitType, player.id)}
                          >
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Kiti Kullan
                          </Button>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">
                              Saglik %{health}
                            </div>
                            <Progress value={health} className="h-2" />
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">
                              Kondisyon %{condition}
                            </div>
                            <Progress value={condition} className="h-2" />
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">
                              Motivasyon %{motivation}
                            </div>
                            <Progress value={motivation} className="h-2" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default KitUsageDialog;

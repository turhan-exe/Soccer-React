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
import { getTeam } from '@/services/team';

type KitUsageDialogProps = {
  open: boolean;
  kitType: KitType | null;
  onOpenChange: (open: boolean) => void;
};

const gaugePercentage = (value?: number | null): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(Math.min(1, Math.max(0, value)) * 100);
  }
  return 75;
};

const normalizePlayers = (players: Player[]): Player[] =>
  players.map((player) => ({ ...player, injuryStatus: player.injuryStatus ?? 'healthy' }));

const KitUsageDialog = ({ open, kitType, onOpenChange }: KitUsageDialogProps) => {
  const { user } = useAuth();
  const { kits, applyKitToPlayer, isProcessing } = useInventory();
  const [search, setSearch] = useState('');
  const [submittingPlayerId, setSubmittingPlayerId] = useState<string | null>(null);

  const { data: players = [], isLoading, refetch } = useQuery({
    queryKey: ['team-players', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const team = await getTeam(user.id);
      if (!team?.players) return [];
      return normalizePlayers(team.players);
    },
    enabled: open && Boolean(user) && Boolean(kitType),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSubmittingPlayerId(null);
    }
  }, [open]);

  const filteredPlayers = useMemo(() => {
    if (!kitType) return [];
    const term = search.trim().toLowerCase();

    const list = players.filter((player) =>
      term.length === 0 ? true : player.name.toLowerCase().includes(term),
    );

    const byCondition = (value: Player) => gaugePercentage(value.condition);
    const byMotivation = (value: Player) => gaugePercentage(value.motivation);

    return list.sort((a, b) => {
      if (kitType === 'health') {
        const aInjured = a.injuryStatus === 'injured' ? 0 : 1;
        const bInjured = b.injuryStatus === 'injured' ? 0 : 1;
        if (aInjured !== bInjured) {
          return aInjured - bInjured;
        }
        return byCondition(a) - byCondition(b);
      }

      if (kitType === 'energy') {
        return byCondition(a) - byCondition(b);
      }

      return byMotivation(a) - byMotivation(b);
    });
  }, [players, search, kitType]);

  const handleApply = async (playerId: string) => {
    if (!kitType) return;
    setSubmittingPlayerId(playerId);
    try {
      await applyKitToPlayer(kitType, playerId);
      await refetch();
      onOpenChange(false);
    } catch (error) {
      console.warn('[KitUsageDialog] apply kit failed', error);
    } finally {
      setSubmittingPlayerId(null);
    }
  };

  const activeConfig = kitType ? KIT_CONFIG[kitType] : null;
  const remaining = kitType ? kits[kitType] ?? 0 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {kitType ? `${activeConfig?.label} Kullan` : 'Kit Seç'}
          </DialogTitle>
          {kitType && (
            <DialogDescription className="space-y-1">
              <span>{activeConfig?.description}</span>
              {kitType && (
                <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {formatKitEffect(kitType)}
                </div>
              )}
            </DialogDescription>
          )}
        </DialogHeader>

        {!kitType && (
          <p className="py-6 text-sm text-muted-foreground">
            Lütfen önce kullanmak istediğiniz kiti seçin.
          </p>
        )}

        {kitType && (
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Oyuncular yükleniyor...
                </div>
              ) : filteredPlayers.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Uygun oyuncu bulunamadı.
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPlayers.map((player) => {
                    const condition = gaugePercentage(player.condition);
                    const motivation = gaugePercentage(player.motivation);
                    const isSubmitting = submittingPlayerId === player.id && isProcessing;

                    return (
                      <div
                        key={player.id}
                        className="rounded-lg border bg-card p-3 shadow-sm transition hover:border-primary/40"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <div className="text-sm font-semibold">{player.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {player.position} • Kondisyon %{condition} • Motivasyon %{motivation}
                            </div>
                            <div className="flex flex-wrap gap-2 pt-1">
                              <Badge variant="outline">Güç {Math.round(player.overall * 100)}</Badge>
                              {player.injuryStatus === 'injured' && (
                                <Badge variant="destructive">Sakat</Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            disabled={remaining === 0 || isProcessing}
                            onClick={() => handleApply(player.id)}
                          >
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Kiti Kullan
                          </Button>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
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

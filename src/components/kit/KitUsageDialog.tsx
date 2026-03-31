import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { useInventory } from "@/contexts/InventoryContext";
import type { KitType, Player } from "@/types";
import { KIT_CONFIG, formatKitEffect } from "@/lib/kits";
import {
  SAFE_KIT_THRESHOLD,
  buildThresholdKitPlan,
  countKitOperations,
  splitKitOperationsByInventory,
  type KitOperation,
} from "@/lib/kitOperations";
import { formatRatingLabel } from "@/lib/player";
import { toGaugePercentage } from "@/lib/playerVitals";
import { getTeam } from "@/services/team";
import {
  getRewardedAdFailureMessage,
  runRewardedAdFlow,
  type RewardedAdSurface,
} from "@/services/rewardedAds";

type KitUsageDialogProps = {
  open: boolean;
  kitType: KitType | null;
  onOpenChange: (open: boolean) => void;
  playerId?: string | null;
  onApplied?: (players: Player[]) => void;
  surface?: RewardedAdSurface;
};

const normalizePlayers = (players: Player[]): Player[] =>
  players.map((player) => ({
    ...player,
    injuryStatus: player.injuryStatus ?? "healthy",
  }));

const AVAILABLE_KIT_TYPES = Object.keys(KIT_CONFIG) as KitType[];

const kitOrder: KitType[] = ["health", "energy", "morale"];
type SquadSelectionRole = Extract<
  Player["squadRole"],
  "starting" | "bench" | "reserve"
>;
const SQUAD_SELECTION_OPTIONS: Array<{
  role: SquadSelectionRole;
  label: string;
}> = [
  { role: "starting", label: "İlk 11" },
  { role: "bench", label: "Yedekler" },
  { role: "reserve", label: "Kadro Dışı" },
];

const getOperationLabel = (operation: KitOperation): string =>
  KIT_CONFIG[operation.type].label;

const uniquePlayerIds = (operations: KitOperation[]): string[] =>
  Array.from(
    new Set(operations.map((operation) => String(operation.playerId)))
  );

const countUniquePlayers = (operations: KitOperation[]): number =>
  uniquePlayerIds(operations).length;

const KitUsageDialog = ({
  open,
  kitType,
  onOpenChange,
  playerId = null,
  onApplied,
  surface,
}: KitUsageDialogProps) => {
  const { user } = useAuth();
  const { kits, applyKitOperations, isProcessing } = useInventory();
  const [search, setSearch] = useState("");
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [pendingOperations, setPendingOperations] = useState<KitOperation[]>(
    []
  );
  const [isRewardingKit, setIsRewardingKit] = useState(false);
  const [activeSquadSelection, setActiveSquadSelection] =
    useState<SquadSelectionRole | null>(null);
  const isPlayerLockedMode = Boolean(playerId);
  const dialogSurface: RewardedAdSurface =
    surface ?? (isPlayerLockedMode ? "team_planning" : "mainmenu");

  const {
    data: players = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["team-players", user?.id],
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
      setSearch("");
      setSubmittingKey(null);
      setSelectedPlayerIds([]);
      setPendingOperations([]);
      setIsRewardingKit(false);
      setActiveSquadSelection(null);
    }
  }, [open]);

  const lockedPlayer = useMemo(() => {
    if (!playerId) return null;
    return (
      players.find((player) => String(player.id) === String(playerId)) ?? null
    );
  }, [playerId, players]);

  const filteredPlayers = useMemo(() => {
    if (!kitType) return [];
    const term = search.trim().toLowerCase();

    const list = players.filter((player) =>
      term.length === 0 ? true : player.name.toLowerCase().includes(term)
    );

    const byHealth = (value: Player) => toGaugePercentage(value.health, 1);
    const byCondition = (value: Player) => toGaugePercentage(value.condition);
    const byMotivation = (value: Player) => toGaugePercentage(value.motivation);

    return list.sort((a, b) => {
      if (kitType === "health") {
        const aInjured = a.injuryStatus === "injured" ? 0 : 1;
        const bInjured = b.injuryStatus === "injured" ? 0 : 1;
        if (aInjured !== bInjured) {
          return aInjured - bInjured;
        }
        return byHealth(a) - byHealth(b);
      }

      if (kitType === "energy") {
        return byCondition(a) - byCondition(b);
      }

      return byMotivation(a) - byMotivation(b);
    });
  }, [players, search, kitType]);

  const lockedPlan = useMemo(
    () =>
      lockedPlayer
        ? buildThresholdKitPlan(lockedPlayer, SAFE_KIT_THRESHOLD)
        : [],
    [lockedPlayer]
  );

  const lockedPlanCounts = useMemo(
    () =>
      countKitOperations(
        pendingOperations.length > 0 ? pendingOperations : lockedPlan
      ),
    [lockedPlan, pendingOperations]
  );

  const selectedOperations = useMemo(
    () =>
      kitType
        ? selectedPlayerIds.map((selectedId) => ({
            type: kitType,
            playerId: selectedId,
          }))
        : [],
    [kitType, selectedPlayerIds]
  );

  const pendingCounts = useMemo(
    () => countKitOperations(pendingOperations),
    [pendingOperations]
  );

  const visiblePlayerIds = useMemo(
    () => filteredPlayers.map((player) => String(player.id)),
    [filteredPlayers]
  );

  const squadRolePlayerIds = useMemo(
    () =>
      SQUAD_SELECTION_OPTIONS.reduce<Record<SquadSelectionRole, string[]>>(
        (accumulator, option) => ({
          ...accumulator,
          [option.role]: filteredPlayers
            .filter((player) => player.squadRole === option.role)
            .map((player) => String(player.id)),
        }),
        {
          starting: [],
          bench: [],
          reserve: [],
        }
      ),
    [filteredPlayers]
  );

  const squadRoleCounts = useMemo(
    () =>
      SQUAD_SELECTION_OPTIONS.reduce<Record<SquadSelectionRole, number>>(
        (accumulator, option) => ({
          ...accumulator,
          [option.role]: squadRolePlayerIds[option.role].length,
        }),
        {
          starting: 0,
          bench: 0,
          reserve: 0,
        }
      ),
    [squadRolePlayerIds]
  );

  const allVisibleSelected =
    visiblePlayerIds.length > 0 &&
    visiblePlayerIds.every((visibleId) =>
      selectedPlayerIds.includes(visibleId)
    );

  const syncPlayersAfterApply = async () => {
    const refreshed = await refetch();
    const refreshedPlayers = normalizePlayers(refreshed.data ?? players);
    return refreshedPlayers;
  };

  const emitAppliedPlayers = (updatedPlayers: Player[]) => {
    if (updatedPlayers.length > 0) {
      onApplied?.(updatedPlayers);
    }
  };

  const runOperations = async (
    operations: KitOperation[],
    options?: {
      successMessage?: string | null;
      closeAfter?: boolean;
      submittingToken?: string;
    }
  ) => {
    if (operations.length === 0) {
      return [];
    }

    setSubmittingKey(options?.submittingToken ?? "bulk");
    try {
      const result = await applyKitOperations(operations, {
        successMessage: options?.successMessage ?? null,
      });
      const refreshedPlayers = await syncPlayersAfterApply();
      const updatedPlayers = refreshedPlayers.filter((player) =>
        result.updatedPlayers.some(
          (updatedPlayer) => String(updatedPlayer.id) === String(player.id)
        )
      );
      emitAppliedPlayers(updatedPlayers);

      if (options?.closeAfter) {
        onOpenChange(false);
      }

      return updatedPlayers;
    } finally {
      setSubmittingKey(null);
    }
  };

  const handleSingleApply = async (
    selectedKitType: KitType,
    targetPlayerId: string
  ) => {
    try {
      await runOperations(
        [{ type: selectedKitType, playerId: targetPlayerId }],
        {
          closeAfter: !isPlayerLockedMode,
          submittingToken: `${selectedKitType}:${targetPlayerId}`,
        }
      );
    } catch (error) {
      console.warn("[KitUsageDialog] apply kit failed", error);
    }
  };

  const continuePendingWithReward = async () => {
    if (!user || pendingOperations.length === 0) {
      return;
    }

    const nextOperation = pendingOperations[0];
    const remainingOperations = pendingOperations.slice(1);

    setSubmittingKey(`reward:${nextOperation.type}:${nextOperation.playerId}`);
    setIsRewardingKit(true);
    try {
      const result = await runRewardedAdFlow({
        userId: user.id,
        placement: "kit_reward",
        context: {
          kitType: nextOperation.type,
          playerId: nextOperation.playerId,
          playerIds: uniquePlayerIds(pendingOperations),
          surface: dialogSurface,
        },
      });

      if (
        result.outcome === "claimed" ||
        result.outcome === "already_claimed"
      ) {
        await runOperations([nextOperation], {
          successMessage: null,
          closeAfter: false,
          submittingToken: `apply-reward:${nextOperation.type}:${nextOperation.playerId}`,
        });
        setPendingOperations(remainingOperations);
        toast.success(
          remainingOperations.length > 0
            ? `${getOperationLabel(
                nextOperation
              )} reklamla kazanildi. Kalan islemler icin devam edebilirsin.`
            : `${getOperationLabel(
                nextOperation
              )} reklamla kazanildi ve uygulandi.`
        );
        return;
      }

      if (result.outcome === "dismissed") {
        toast.info("Odulu almak icin reklami tamamlamalisin.");
        return;
      }

      if (result.outcome === "pending_verification") {
        toast.info("Reklam odulu dogrulaniyor. Biraz sonra tekrar deneyin.");
        return;
      }

      toast.error(getRewardedAdFailureMessage(result.ad));
    } catch (error) {
      console.warn("[KitUsageDialog] rewarded continue failed", error);
      toast.error(getRewardedAdFailureMessage(error));
    } finally {
      setIsRewardingKit(false);
      setSubmittingKey(null);
    }
  };

  const handleRewardedSingleApply = async (
    selectedKitType: KitType,
    targetPlayerId: string
  ) => {
    if (!user) {
      toast.error("Kit odulu icin giris yapmalisin.");
      return;
    }

    setSubmittingKey(`reward:${selectedKitType}:${targetPlayerId}`);
    setIsRewardingKit(true);
    try {
      const result = await runRewardedAdFlow({
        userId: user.id,
        placement: "kit_reward",
        context: {
          kitType: selectedKitType,
          playerId: targetPlayerId,
          surface: dialogSurface,
        },
      });

      if (
        result.outcome === "claimed" ||
        result.outcome === "already_claimed"
      ) {
        await runOperations(
          [{ type: selectedKitType, playerId: targetPlayerId }],
          {
            successMessage: null,
            closeAfter: !isPlayerLockedMode,
            submittingToken: `apply-reward:${selectedKitType}:${targetPlayerId}`,
          }
        );
        toast.success(
          `${KIT_CONFIG[selectedKitType].label} reklamla kazanildi ve uygulandi.`
        );
        return;
      }

      if (result.outcome === "dismissed") {
        toast.info("Odulu almak icin reklami tamamlamalisin.");
        return;
      }

      if (result.outcome === "pending_verification") {
        toast.info("Reklam odulu dogrulaniyor. Biraz sonra tekrar deneyin.");
        return;
      }

      toast.error(getRewardedAdFailureMessage(result.ad));
    } catch (error) {
      console.warn("[KitUsageDialog] rewarded single apply failed", error);
      toast.error(getRewardedAdFailureMessage(error));
    } finally {
      setIsRewardingKit(false);
      setSubmittingKey(null);
    }
  };

  const handleLockedBulkApply = async () => {
    const operations =
      pendingOperations.length > 0 ? pendingOperations : lockedPlan;
    if (operations.length === 0) {
      toast.info("Oyuncunun su anda kit ihtiyaci yok.");
      return;
    }

    const { ready, pending } = splitKitOperationsByInventory(operations, kits);
    if (ready.length > 0) {
      try {
        await runOperations(ready, {
          successMessage: null,
          closeAfter: false,
          submittingToken: "locked-bulk",
        });
        setPendingOperations(pending);
        if (pending.length > 0) {
          toast.info(
            `${ready.length} kit uygulandi. Kalan islemler icin reklamla devam edebilirsin.`
          );
        } else {
          toast.success("Oyuncunun eksikleri guvenli seviyeye tamamlandi.");
        }
      } catch (error) {
        console.warn("[KitUsageDialog] locked bulk apply failed", error);
      }
      return;
    }

    setPendingOperations(operations);
    await continuePendingWithReward();
  };

  const handleApplySelected = async () => {
    if (!kitType) {
      return;
    }

    const operations =
      pendingOperations.length > 0 ? pendingOperations : selectedOperations;
    if (operations.length === 0) {
      toast.info("Toplu uygulama icin once oyuncu secmelisin.");
      return;
    }

    const { ready, pending } = splitKitOperationsByInventory(operations, kits);
    if (ready.length > 0) {
      try {
        await runOperations(ready, {
          successMessage: null,
          closeAfter: false,
          submittingToken: "multi-bulk",
        });
        setSelectedPlayerIds(uniquePlayerIds(pending));
        setPendingOperations(pending);
        if (pending.length > 0) {
          toast.info(
            `${ready.length} oyuncuya kit uygulandi. Kalanlar icin reklamla devam edebilirsin.`
          );
        } else {
          toast.success(`${ready.length} oyuncuya kit uygulandi.`);
        }
      } catch (error) {
        console.warn("[KitUsageDialog] multi apply failed", error);
      }
      return;
    }

    setPendingOperations(operations);
    await continuePendingWithReward();
  };

  const togglePlayerSelection = (
    candidatePlayerId: string,
    checked: boolean
  ) => {
    setPendingOperations([]);
    setActiveSquadSelection(null);
    setSelectedPlayerIds((previous) => {
      if (checked) {
        return Array.from(new Set([...previous, candidatePlayerId]));
      }
      return previous.filter((playerKey) => playerKey !== candidatePlayerId);
    });
  };

  const selectAllVisiblePlayers = () => {
    setPendingOperations([]);
    setActiveSquadSelection(null);
    setSelectedPlayerIds((previous) =>
      Array.from(new Set([...previous, ...visiblePlayerIds]))
    );
  };

  const clearVisibleSelection = () => {
    setPendingOperations([]);
    setActiveSquadSelection(null);
    setSelectedPlayerIds((previous) =>
      previous.filter((playerKey) => !visiblePlayerIds.includes(playerKey))
    );
  };

  const handleSquadSelection = (role: SquadSelectionRole) => {
    const roleIds = squadRolePlayerIds[role];
    const allSelected =
      roleIds.length > 0 &&
      roleIds.every((playerId) => selectedPlayerIds.includes(playerId));

    setPendingOperations([]);

    if (activeSquadSelection === role && allSelected) {
      setSelectedPlayerIds([]);
      setActiveSquadSelection(null);
      return;
    }

    setSelectedPlayerIds(roleIds);
    setActiveSquadSelection(role);
  };

  const activeConfig = kitType ? KIT_CONFIG[kitType] : null;
  const remaining = kitType ? kits[kitType] ?? 0 : 0;
  const pendingLabel =
    pendingOperations.length > 0
      ? `Bekleyen ${pendingOperations.length} işlem`
      : null;

  const lockedBulkLabel =
    pendingOperations.length > 0
      ? "Reklam İzle ve Devam Et"
      : lockedPlan.length === 0
      ? "Oyuncu Hazır"
      : "Eksikleri Toplu Tamamla";

  const multiBulkLabel =
    pendingOperations.length > 0 ||
    (selectedOperations.length > 0 && remaining === 0)
      ? "Reklam İzle ve Devam Et"
      : "Seçililere Uygula";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isPlayerLockedMode
              ? "Kitleri Kullan"
              : kitType
              ? `${activeConfig?.label} Kullan`
              : "Kit Seç"}
          </DialogTitle>
          {isPlayerLockedMode ? (
            <DialogDescription className="space-y-1">
              <span>
                {lockedPlayer
                  ? `${lockedPlayer.name} için tekli veya toplu kit kullanabilirsin.`
                  : "Seçili oyuncu yükleniyor."}
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

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {!isPlayerLockedMode && !kitType && (
            <p className="py-6 text-sm text-muted-foreground">
              Lütfen önce kullanmak istediğin kiti seç.
            </p>
          )}

          {isPlayerLockedMode && (
            <div className="space-y-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Oyuncu
                  bilgileri yükleniyor...
                </div>
              ) : !lockedPlayer ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Seçili oyuncu bulunamadı.
                </div>
              ) : (
                <>
                  <div className="rounded-lg border bg-card p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold">
                          {lockedPlayer.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {lockedPlayer.position} - Güç{" "}
                          {formatRatingLabel(lockedPlayer.overall)}
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Badge variant="outline">
                            Yaş {lockedPlayer.age}
                          </Badge>
                          {lockedPlayer.injuryStatus === "injured" && (
                            <Badge variant="destructive">Sakat</Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">
                          Sağlık %{toGaugePercentage(lockedPlayer.health, 1)}
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
                          Motivasyon %
                          {toGaugePercentage(lockedPlayer.motivation)}
                        </div>
                        <Progress
                          value={toGaugePercentage(lockedPlayer.motivation)}
                          className="h-2"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-card p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold">
                          Toplu Tamamlama
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Sağlık, kondisyon ve motivasyon değerleri en az %
                          {Math.round(SAFE_KIT_THRESHOLD * 100)} seviyesine
                          gelir.
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={
                          (lockedPlan.length === 0 &&
                            pendingOperations.length === 0) ||
                          isProcessing ||
                          isRewardingKit
                        }
                        onClick={handleLockedBulkApply}
                      >
                        {(submittingKey === "locked-bulk" ||
                          isRewardingKit) && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        {lockedBulkLabel}
                      </Button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {kitOrder.map((availableKitType) => (
                        <Badge key={availableKitType} variant="outline">
                          {KIT_CONFIG[availableKitType].label}:{" "}
                          {lockedPlanCounts[availableKitType]}
                        </Badge>
                      ))}
                      {pendingLabel && (
                        <Badge variant="secondary">{pendingLabel}</Badge>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {AVAILABLE_KIT_TYPES.map((availableKitType) => {
                      const config = KIT_CONFIG[availableKitType];
                      const availableCount = kits[availableKitType] ?? 0;
                      const isSubmitting =
                        submittingKey ===
                          `${availableKitType}:${lockedPlayer.id}` &&
                        isProcessing;
                      const isRewarding =
                        submittingKey ===
                          `reward:${availableKitType}:${lockedPlayer.id}` &&
                        isRewardingKit;

                      return (
                        <div
                          key={availableKitType}
                          className="rounded-lg border bg-card p-4 shadow-sm transition hover:border-primary/40"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-semibold">
                                  {config.label}
                                </div>
                                <Badge
                                  variant={
                                    availableCount > 0 ? "secondary" : "outline"
                                  }
                                >
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
                              disabled={isProcessing || isRewardingKit}
                              onClick={() => {
                                if (availableCount <= 0) {
                                  void handleRewardedSingleApply(
                                    availableKitType,
                                    lockedPlayer.id
                                  );
                                  return;
                                }
                                void handleSingleApply(
                                  availableKitType,
                                  lockedPlayer.id
                                );
                              }}
                            >
                              {(isSubmitting || isRewarding) && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              )}
                              {availableCount === 0 ? "Reklam İzle" : "Kullan"}
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
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span>Kalan stok:</span>
                  <Badge variant={remaining > 0 ? "secondary" : "outline"}>
                    {remaining}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {selectedPlayerIds.length} seçili oyuncu
                  </Badge>
                  {pendingOperations.length > 0 && (
                    <Badge variant="secondary">
                      {pendingOperations.length} bekleyen işlem
                    </Badge>
                  )}
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-2">
                  <div>
                    <div className="text-sm font-semibold">Hızlı Seçim</div>
                    <div className="text-xs text-muted-foreground">
                      Takım grubuna göre oyuncuları tek dokunuşla seç.
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {SQUAD_SELECTION_OPTIONS.map((option) => {
                      const roleIds = squadRolePlayerIds[option.role];
                      const isActive =
                        activeSquadSelection === option.role &&
                        roleIds.length > 0 &&
                        roleIds.every((playerId) =>
                          selectedPlayerIds.includes(playerId)
                        );

                      return (
                        <Button
                          key={option.role}
                          type="button"
                          variant={isActive ? "default" : "outline"}
                          size="sm"
                          className="h-auto min-h-11 whitespace-normal px-2 py-2 text-center text-[11px] leading-tight sm:text-xs"
                          disabled={
                            roleIds.length === 0 ||
                            isProcessing ||
                            isRewardingKit
                          }
                          onClick={() => handleSquadSelection(option.role)}
                        >
                          <span className="block">{option.label}</span>
                          <span className="mt-1 block text-[10px] opacity-80 sm:text-[11px]">
                            {squadRoleCounts[option.role]} oyuncu
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold">Toplu Uygulama</div>
                    <div className="text-xs text-muted-foreground">
                      Seçili oyunculara bu kitten birer kez uygular.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={
                      (selectedPlayerIds.length === 0 &&
                        pendingOperations.length === 0) ||
                      isProcessing ||
                      isRewardingKit
                    }
                    onClick={() => void handleApplySelected()}
                  >
                    {(submittingKey === "multi-bulk" || isRewardingKit) && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {multiBulkLabel}
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      visiblePlayerIds.length === 0 ||
                      allVisibleSelected ||
                      isProcessing ||
                      isRewardingKit
                    }
                    onClick={selectAllVisiblePlayers}
                  >
                    <CheckSquare className="mr-2 h-4 w-4" />
                    Görünenleri Seç
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      selectedPlayerIds.length === 0 ||
                      isProcessing ||
                      isRewardingKit
                    }
                    onClick={clearVisibleSelection}
                  >
                    Seçimi Temizle
                  </Button>
                  {pendingOperations.length > 0 && (
                    <>
                      {kitOrder.map((typeKey) => (
                        <Badge key={typeKey} variant="outline">
                          {KIT_CONFIG[typeKey].label}: {pendingCounts[typeKey]}
                        </Badge>
                      ))}
                    </>
                  )}
                </div>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Oyuncu ara"
                  value={search}
                  onChange={(event) => {
                    setPendingOperations([]);
                    setActiveSquadSelection(null);
                    setSearch(event.target.value);
                  }}
                  className="pl-9"
                />
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Oyuncular
                  yükleniyor...
                </div>
              ) : filteredPlayers.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Uygun oyuncu bulunamadı.
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPlayers.map((player) => {
                    const health = toGaugePercentage(player.health, 1);
                    const condition = toGaugePercentage(player.condition);
                    const motivation = toGaugePercentage(player.motivation);
                    const isSubmitting =
                      submittingKey === `${kitType}:${player.id}` &&
                      isProcessing;
                    const isRewarding =
                      submittingKey === `reward:${kitType}:${player.id}` &&
                      isRewardingKit;
                    const isSelected = selectedPlayerIds.includes(
                      String(player.id)
                    );

                    return (
                      <div
                        key={player.id}
                        className="rounded-lg border bg-card p-3 shadow-sm transition hover:border-primary/40"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={isSelected}
                              disabled={isProcessing || isRewardingKit}
                              onCheckedChange={(checked) =>
                                togglePlayerSelection(
                                  String(player.id),
                                  checked === true
                                )
                              }
                              className="mt-1"
                            />
                            <div className="space-y-1">
                              <div className="text-sm font-semibold">
                                {player.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {player.position} - Sağlık %{health} - Kondisyon
                                %{condition} - Motivasyon %{motivation}
                              </div>
                              <div className="flex flex-wrap gap-2 pt-1">
                                <Badge variant="outline">
                                  Güç {formatRatingLabel(player.overall)}
                                </Badge>
                                {player.injuryStatus === "injured" && (
                                  <Badge variant="destructive">Sakat</Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            disabled={isProcessing || isRewardingKit}
                            onClick={() => {
                              if (remaining <= 0) {
                                void handleRewardedSingleApply(
                                  kitType,
                                  player.id
                                );
                                return;
                              }
                              void handleSingleApply(kitType, player.id);
                            }}
                          >
                            {(isSubmitting || isRewarding) && (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            {remaining === 0 ? "Reklam İzle" : "Kiti Kullan"}
                          </Button>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">
                              Sağlık %{health}
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
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default KitUsageDialog;

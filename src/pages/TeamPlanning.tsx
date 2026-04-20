import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerCard } from "@/components/ui/player-card";
import {
  PerformanceGauge,
  clampPerformanceGauge,
} from "@/components/ui/performance-gauge";
import type { Player } from "@/types";
import { getTeam, saveTeamPlayers, createInitialTeam } from "@/services/team";
import {
  buildSalaryNegotiationProfile,
  clampNumber,
  formatSalary,
  type SalaryNegotiationProfile,
} from "@/lib/contractNegotiation";
import {
  completeLegendRental,
  getLegendIdFromPlayer,
} from "@/services/legends";
import { auth } from "@/services/firebase";
import {
  getRewardedAdFailureMessage,
  runRewardedAdFlow,
} from "@/services/rewardedAds";
import { useAuth } from "@/contexts/AuthContext";
import { useDiamonds } from "@/contexts/DiamondContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { Search, Save, Eye, X, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formations } from "@/lib/formations";
import {
  buildFreeFormationAssignments,
  buildFreeFormationLayoutRecord,
  countGoalkeeperZoneAssignments,
  findOverlappingAssignment,
  hasFreeFormationOverlap,
  normalizeFreeFormationPoint,
} from "@/lib/freeFormation";
import {
  normalizeRatingTo100,
  calculatePowerIndex,
  formatRatingLabel,
} from "@/lib/player";
import { cn } from "@/lib/utils";
import { BackButton } from "@/components/ui/back-button";
import Pitch, { type PitchSlot } from "@/features/team-planning/Pitch";
import {
  TeamPlanningProvider,
  useTeamPlanningStore,
  type MetricKey,
} from "@/features/team-planning/useTeamPlanningStore";
import { ContractDecisionDialog } from "@/features/team-planning/dialogs/ContractDecisionDialog";
import { RenamePlayerDialog } from "@/features/team-planning/dialogs/RenamePlayerDialog";
import { SalaryNegotiationDialog } from "@/features/team-planning/dialogs/SalaryNegotiationDialog";
import { LineupReadinessDialog } from "@/features/team-planning/dialogs/LineupReadinessDialog";
import { PlayerDetailOverlay } from "@/features/team-planning/components/PlayerDetailOverlay";
import KitUsageDialog from "@/components/kit/KitUsageDialog";
import {
  addMonths,
  buildDisplayPlayer,
  canonicalPosition,
  clampPercentageValue,
  CONTRACT_EXTENSION_MONTHS,
  CustomFormationState,
  DEFAULT_GAUGE_VALUE,
  DisplayPlayer,
  FormationPlayerPosition,
  PlayerBaseline,
  getContractExpiration,
  getPlayerCondition,
  getPlayerHealth,
  getLineupReadinessIssues,
  getPlayerMotivation,
  getPlayerPower,
  getMetricLabel,
  getPositionLabel,
  getRenameAdAvailability,
  HOURS_IN_MS,
  isContractExpired,
  isRenameAdReady,
  LINEUP_VITAL_THRESHOLD,
  metricOptions,
  MIN_SALARY_OFFER,
  normalizePlayers,
  PLAYER_RENAME_AD_COOLDOWN_HOURS,
  PLAYER_RENAME_DIAMOND_COST,
  promotePlayerToStartingRoster,
  sanitizeCustomFormationState,
  squadRoleWeight,
  deriveFormationShape,
  negotiationConfidenceFromOffer,
} from "@/features/team-planning/teamPlanningUtils";
import { AlternativePlayerBubble } from "@/features/team-planning/components/AlternativePlayerBubble";
import { buildBestLineupForFormation } from "@/features/team-planning/bestLineup";
import {
  getZoneDefinition,
  recommendPlayers,
  resolveFormationSlotZoneId,
  resolveSlotZoneId,
  positionAffinity,
  type SlotFitLevel,
  type ZoneId,
} from "@/features/team-planning/slotZones";

import "./team-planning.css";
import "./TeamPlanningSizing.css";

type SelectedSlotMeta = {
  slotIndex: number;
  zoneId: ZoneId;
  x: number;
  y: number;
  position: Player["position"];
};

type AutoFillAssignment = {
  playerId: string;
  slotIndex: number;
  zoneId: ZoneId;
  position: Player["position"];
  x: number;
  y: number;
};

type DragSlotHighlight = {
  slotIndex: number;
  fitLevel: SlotFitLevel;
};

function TeamPlanningContent() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { balance, spend } = useDiamonds();
  const { t, formatDate, language } = useTranslation();
  const [players, setPlayers] = useState<Player[]>([]);
  const playerBaselineRef = useRef<Record<string, PlayerBaseline>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("starting");
  const [selectedFormation, setSelectedFormation] = useState(
    formations[0].name
  );
  const [customFormations, setCustomFormations] =
    useState<CustomFormationState>({});
  const [bootstrappedUserId, setBootstrappedUserId] = useState<string | null>(
    null
  );

  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"role" | "overall" | "potential">(
    "role"
  );
  const [focusedPlayerId, setFocusedPlayerId] = useState<string | null>(null);
  const [, setSavedFormationShape] = useState<string | null>(
    null
  );
  const [renamePlayerId, setRenamePlayerId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [isRenamingPlayer, setIsRenamingPlayer] = useState(false);
  const [pendingContractIds, setPendingContractIds] = useState<string[]>([]);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [isProcessingContract, setIsProcessingContract] = useState(false);
  const [negotiationPlayerId, setNegotiationPlayerId] = useState<string | null>(
    null
  );
  const [negotiationOffer, setNegotiationOffer] = useState(0);
  const [isNegotiatingSalary, setIsNegotiatingSalary] = useState(false);
  const [negotiationAttempts, setNegotiationAttempts] = useState(0);
  const [playerCounterOffer, setPlayerCounterOffer] = useState<number | null>(
    null
  );
  const [isFinalCounterStage, setIsFinalCounterStage] = useState(false);
  const MAX_NEGOTIATION_ATTEMPTS = 3;

  const pitchRef = useRef<HTMLDivElement | null>(null);
  const dropHandledRef = useRef(false);
  const handledContractsRef = useRef<Set<string>>(new Set());
  const rightPaneScrollRef = useRef<HTMLDivElement | null>(null);
  const [isRightHeaderCollapsed, setIsRightHeaderCollapsed] = useState(false);
  const teamLeagueIdRef = useRef<string | null>(null);
  const [selectedSlotMeta, setSelectedSlotMeta] =
    useState<SelectedSlotMeta | null>(null);
  const [isListCollapsed, setIsListCollapsed] = useState(false);
  const [isDetailOverlayOpen, setIsDetailOverlayOpen] = useState(false);
  const [isKitUsageOpen, setIsKitUsageOpen] = useState(false);
  const [kitUsagePlayerId, setKitUsagePlayerId] = useState<string | null>(null);
  const [isLineupReadinessOpen, setIsLineupReadinessOpen] = useState(false);
  const [resumeLineupReadinessAfterKit, setResumeLineupReadinessAfterKit] =
    useState(false);
  /* isListCollapsed already declared above */

  const { selectedMetric, setSelectedMetric } = useTeamPlanningStore();

  useEffect(() => {
    players.forEach((player) => {
      if (playerBaselineRef.current[player.id]) {
        return;
      }
      playerBaselineRef.current[player.id] = {
        naturalPosition: player.position,
        naturalOverall: player.overall,
      };
    });
  }, [players]);

  const displayPlayers = useMemo(
    () =>
      players.map((player) =>
        buildDisplayPlayer(player, playerBaselineRef.current[player.id])
      ),
    [players]
  );

  const handleRightPaneScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const collapsed = event.currentTarget.scrollTop >= 24;
      setIsRightHeaderCollapsed((previous) =>
        previous === collapsed ? previous : collapsed
      );
    },
    []
  );

  useEffect(() => {
    const container = rightPaneScrollRef.current;
    if (!container) {
      return;
    }
    setIsRightHeaderCollapsed(container.scrollTop >= 24);
  }, []);

  const filteredPlayers = displayPlayers.filter(
    (player) =>
      player.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      player.squadRole === activeTab
  );

  const getRatingAnnotation = useCallback(
    (player: DisplayPlayer) =>
      player.originalOverall > player.assignedOverall
        ? `Orj: ${formatRatingLabel(player.originalOverall)}`
        : undefined,
    []
  );

  const POSITION_ORDER: Player["position"][] = [
    "GK",
    "LB",
    "CB",
    "RB",
    "LM",
    "CM",
    "RM",
    "CAM",
    "LW",
    "RW",
    "ST",
  ];

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    switch (sortBy) {
      case "overall":
        return b.overall - a.overall;
      case "potential":
        return b.potential - a.potential;
      default:
        return (
          POSITION_ORDER.indexOf(a.position) -
          POSITION_ORDER.indexOf(b.position)
        );
    }
  });

  const renamePlayer = useMemo(
    () => displayPlayers.find((player) => player.id === renamePlayerId) ?? null,
    [displayPlayers, renamePlayerId]
  );

  const activeContractPlayer = useMemo(
    () =>
      displayPlayers.find((player) => player.id === activeContractId) ?? null,
    [displayPlayers, activeContractId]
  );

  const negotiationPlayer = useMemo(
    () =>
      displayPlayers.find((player) => player.id === negotiationPlayerId) ??
      null,
    [displayPlayers, negotiationPlayerId]
  );

  const salaryNegotiationProfile = useMemo(
    () =>
      negotiationPlayer
        ? buildSalaryNegotiationProfile(negotiationPlayer, {
            gaugeFallback: DEFAULT_GAUGE_VALUE,
          })
        : null,
    [negotiationPlayer]
  );

  useEffect(() => {
    if (!salaryNegotiationProfile) {
      setNegotiationOffer(0);
      return;
    }
    const floor = salaryNegotiationProfile.floor;
    const ceiling = salaryNegotiationProfile.ceiling;
    setNegotiationOffer((prev) => {
      if (prev >= floor && prev <= ceiling) {
        return prev;
      }
      return Math.max(floor, salaryNegotiationProfile.managerSuggested);
    });
  }, [salaryNegotiationProfile]);

  const negotiationConfidence = useMemo(
    () =>
      negotiationConfidenceFromOffer(
        negotiationOffer,
        salaryNegotiationProfile,
        negotiationPlayer
      ),
    [negotiationOffer, salaryNegotiationProfile, negotiationPlayer]
  );

  const resetNegotiationState = useCallback(() => {
    setNegotiationAttempts(0);
    setPlayerCounterOffer(null);
    setIsFinalCounterStage(false);
    setNegotiationOffer(0);
  }, []);

  const buildPlayerCounterOffer = useCallback(
    (
      offer: number,
      profile: SalaryNegotiationProfile,
      attemptNumber: number
    ) => {
      const anchor = Math.max(profile.demand, profile.baseSalary);
      const comfortFloor = Math.max(profile.floor, Math.round(anchor * 0.55));
      const weight = clampNumber(0.35 + attemptNumber * 0.15, 0.35, 0.9);
      const blended = offer * weight + anchor * (1 - weight);
      const counter = clampNumber(
        Math.round(blended),
        Math.max(offer, comfortFloor),
        profile.ceiling
      );
      return counter;
    },
    []
  );

  useEffect(() => {
    if (!negotiationPlayer) {
      resetNegotiationState();
    }
  }, [negotiationPlayer, resetNegotiationState]);

  const isRenameAdAvailable = renamePlayer
    ? isRenameAdReady(renamePlayer)
    : true;
  const renameAdAvailableAt = renamePlayer
    ? getRenameAdAvailability(renamePlayer)
    : null;

  const [manualSlotPositions, setManualSlotPositions] = useState<
    Record<string, FormationPlayerPosition>
  >({});
  const syncManualSlotsForFormation = useCallback(
    (formationName: string) => {
      const layout = customFormations[formationName];
      if (!layout) {
        setManualSlotPositions((prev) => {
          if (Object.keys(prev).length === 0) {
            return prev;
          }
          return {};
        });
        return;
      }
      const normalized = Object.fromEntries(
        Object.entries(layout).map(([playerId, value]) => [
          playerId,
          {
            x: clampPercentageValue(value.x),
            y: clampPercentageValue(value.y),
            position: value.position,
            ...(typeof value.zoneId === "string" && value.zoneId.trim()
              ? { zoneId: value.zoneId.trim() }
              : {}),
          },
        ])
      ) as Record<string, FormationPlayerPosition>;
      setManualSlotPositions((prev) => {
        if (
          Object.keys(prev).length === Object.keys(normalized).length &&
          Object.entries(normalized).every(([playerId, nextValue]) => {
            const current = prev[playerId];
            return (
              current &&
              current.x === nextValue.x &&
              current.y === nextValue.y &&
              current.position === nextValue.position &&
              current.zoneId === nextValue.zoneId
            );
          })
        ) {
          return prev;
        }
        return normalized;
      });
    },
    [customFormations]
  );

  const removePlayerFromCustomFormations = (playerId: string) => {
    setCustomFormations((prev) => {
      let changed = false;
      const nextEntries: [string, Record<string, FormationPlayerPosition>][] =
        [];

      Object.entries(prev).forEach(([formationKey, layout]) => {
        if (!layout || typeof layout !== "object") {
          return;
        }

        if (playerId in layout) {
          const { [playerId]: _removed, ...rest } = layout;
          changed = true;
          if (Object.keys(rest).length > 0) {
            nextEntries.push([
              formationKey,
              rest as Record<string, FormationPlayerPosition>,
            ]);
          }
        } else {
          nextEntries.push([formationKey, layout]);
        }
      });

      if (!changed) {
        return prev;
      }

      return Object.fromEntries(nextEntries) as CustomFormationState;
    });
    setManualSlotPositions((prev) => {
      if (!(playerId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[playerId];
      return next;
    });
  };

  const removePlayerFromFormationLayout = useCallback(
    (playerId: string, formationName = selectedFormation) => {
      setCustomFormations((prev) => {
        const currentFormation = prev[formationName];
        if (!currentFormation || !(playerId in currentFormation)) {
          return prev;
        }

        const { [playerId]: _removed, ...rest } = currentFormation;
        if (Object.keys(rest).length === 0) {
          const next = { ...prev };
          delete next[formationName];
          return next;
        }

        return {
          ...prev,
          [formationName]: rest as Record<string, FormationPlayerPosition>,
        };
      });

      if (formationName !== selectedFormation) {
        return;
      }

      setManualSlotPositions((prev) => {
        if (!(playerId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
    },
    [selectedFormation]
  );

  const clearFormationManualLayout = useCallback(
    (formationName = selectedFormation) => {
      setCustomFormations((prev) => {
        if (!(formationName in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[formationName];
        return next;
      });

      if (formationName === selectedFormation) {
        setManualSlotPositions((prev) =>
          Object.keys(prev).length === 0 ? prev : {}
        );
      }
    },
    [selectedFormation]
  );

  const updatePlayerManualPosition = useCallback(
    (
      formationName: string,
      playerId: string,
      data: FormationPlayerPosition
    ) => {
      setCustomFormations((prev) => {
        const currentFormation = prev[formationName] ?? {};
        const normalized: FormationPlayerPosition = {
          x: clampPercentageValue(data.x),
          y: clampPercentageValue(data.y),
          position: data.position,
          ...(typeof data.zoneId === "string" && data.zoneId.trim()
            ? { zoneId: data.zoneId.trim() }
            : {}),
        };

        const existing = currentFormation[playerId];
        if (
          existing &&
          existing.x === normalized.x &&
          existing.y === normalized.y &&
          existing.position === normalized.position &&
          existing.zoneId === normalized.zoneId
        ) {
          return prev;
        }

        return {
          ...prev,
          [formationName]: {
            ...currentFormation,
            [playerId]: normalized,
          },
        };
      });
    },
    []
  );

  const finalizeContractDecision = (playerId: string) => {
    handledContractsRef.current.add(playerId);
    setPendingContractIds((prev) => prev.filter((id) => id !== playerId));
    setActiveContractId((prev) => (prev === playerId ? null : prev));
  };

  const movePlayer = (playerId: string, newRole: Player["squadRole"]) => {
    let errorMessage: string | null = null;
    let changed = false;
    let swappedPlayerId: string | null = null;
    let filledStartingVacancy = false;
    let movedPlayerPosition: Player["position"] | null = null;

    setPlayers((prev) => {
      const playerIndex = prev.findIndex((player) => player.id === playerId);
      if (playerIndex === -1) {
        errorMessage = t("teamPlanning.errors.playerNotFound");
        return prev;
      }

      const player = prev[playerIndex];
      movedPlayerPosition = player.position;
      if (newRole === "starting") {
        const hadStartingVacancy =
          prev.filter((candidate) => candidate.squadRole === "starting")
            .length < 11;
        const result = promotePlayerToStartingRoster(prev, playerId);
        if (result.error) {
          errorMessage = result.error;
          return prev;
        }
        if (!result.updated) {
          return prev;
        }
        changed = true;
        swappedPlayerId = result.swappedPlayerId ?? null;
        filledStartingVacancy = hadStartingVacancy && !result.swappedPlayerId;
        return result.players;
      }

      if (player.squadRole === newRole) {
        return prev;
      }

      const next = [...prev];
      next[playerIndex] = {
        ...player,
        squadRole: newRole,
      };
      changed = true;
      return normalizePlayers(next);
    });

    if (errorMessage) {
      toast.error(t("teamPlanning.toasts.actionFailed"), {
        description: errorMessage,
      });
    } else if (changed) {
      if (newRole !== "starting") {
        removePlayerFromCustomFormations(playerId);
      } else if (swappedPlayerId) {
        removePlayerFromCustomFormations(swappedPlayerId);
      }
      if (newRole === "starting") {
        if (filledStartingVacancy) {
          toast.success(t("teamPlanning.toasts.movedToEmptySlot"), {
            description: movedPlayerPosition
              ? t("teamPlanning.toasts.movedToEmptySlotDescription", {
                  position: getPositionLabel(movedPlayerPosition, language),
                })
              : t("teamPlanning.toasts.movedToEmptySlotDescriptionGeneric"),
          });
        } else if (swappedPlayerId) {
          toast.success(t("teamPlanning.toasts.movedToStarting"), {
            description: t("teamPlanning.toasts.movedToStartingSwapDescription"),
          });
        } else {
          toast.success(t("teamPlanning.toasts.movedToStarting"));
        }
        return;
      }
      toast.success(t("teamPlanning.toasts.movedSuccess"));
    }
  };

  const handleRenamePlayer = async (method: "ad" | "purchase") => {
    if (!user || !renamePlayer) {
      return;
    }

    const userId = user.id;
    const trimmed = renameInput.trim();
    if (trimmed.length < 2) {
      toast.error(t("teamPlanning.errors.invalidName"));
      return;
    }

    if (trimmed === renamePlayer.name) {
      toast.info(t("teamPlanning.toasts.renameUnchanged"));
      return;
    }

    if (method === "ad" && !isRenameAdAvailable) {
      const availableAt = getRenameAdAvailability(renamePlayer);
      const message = availableAt
        ? t("teamPlanning.toasts.renameAdAvailableAt", {
            date: formatDate(availableAt, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })
        : t("teamPlanning.toasts.renameAdUnavailable");
      toast.error(message);
      return;
    }

    if (method === "purchase" && balance < PLAYER_RENAME_DIAMOND_COST) {
      toast.error(t("teamPlanning.errors.insufficientDiamonds"));
      return;
    }

    const previousPlayers = players.map((player) => ({ ...player }));
    let diamondsSpent = false;

    setIsRenamingPlayer(true);

    try {
      if (method === "ad") {
        const result = await runRewardedAdFlow({
          userId,
          placement: "player_rename",
          context: {
            surface: "team_planning",
            playerId: renamePlayer.id,
            newName: trimmed,
          },
        });

        if (
          result.outcome === "claimed" ||
          result.outcome === "already_claimed"
        ) {
          const refreshedTeam = await getTeam(userId);
          if (refreshedTeam) {
            setPlayers(normalizePlayers(refreshedTeam.players));
          }
          toast.success(t("teamPlanning.toasts.renameUpdatedLegacy"));
          setRenamePlayerId(null);
          return;
        }

        if (result.outcome === "dismissed") {
          toast.info(t("teamPlanning.toasts.renameAdDismissed"));
        } else if (result.outcome === "pending_verification") {
          toast.info(t("teamPlanning.toasts.renameAdPending"));
        } else {
          toast.error(getRewardedAdFailureMessage(result.ad));
        }
        return;
      }

      await spend(PLAYER_RENAME_DIAMOND_COST);
      diamondsSpent = true;

      const now = new Date();
      const adCooldown = new Date(
        now.getTime() + PLAYER_RENAME_AD_COOLDOWN_HOURS * HOURS_IN_MS
      );

      const updatedPlayers = normalizePlayers(
        players.map((player) => {
          if (player.id !== renamePlayer.id) {
            return player;
          }
          const currentRename = player.rename ?? {
            adAvailableAt: new Date(0).toISOString(),
          };
          return {
            ...player,
            name: trimmed,
            rename: {
              ...currentRename,
              lastUpdatedAt: now.toISOString(),
              lastMethod: method === "purchase" ? "purchase" : "ad",
              adAvailableAt:
                method === "ad"
                  ? adCooldown.toISOString()
                  : currentRename.adAvailableAt ?? now.toISOString(),
            },
          };
        })
      );

      setPlayers(updatedPlayers);
      await saveTeamPlayers(userId, updatedPlayers);
      toast.success(t("teamPlanning.toasts.renameUpdated"));
      setRenamePlayerId(null);
    } catch (error) {
      console.error("[TeamPlanning] player rename failed", error);
      toast.error(t("teamPlanning.errors.renameFailed"));
      if (method === "purchase") {
        setPlayers(previousPlayers);
      }
      if (method === "purchase" && diamondsSpent) {
        toast.error(t("teamPlanning.toasts.renameRefundSupport"));
      }
    } finally {
      setIsRenamingPlayer(false);
    }
  };

  const openSalaryNegotiation = (playerId: string) => {
  const target = displayPlayers.find((player) => player.id === playerId);
  if (!target) {
    return;
  }
  if (getLegendIdFromPlayer(target) !== null) {
    toast.error(t("teamPlanning.errors.negotiationLegend"));
    return;
  }
  resetNegotiationState();
  setNegotiationPlayerId(playerId);
};

const completeSalaryNegotiation = async (agreedSalary: number) => {
  if (!user || !negotiationPlayer || !salaryNegotiationProfile) {
    return;
  }
  const clampedOffer = clampNumber(
    Math.round(agreedSalary),
    salaryNegotiationProfile.floor,
    salaryNegotiationProfile.ceiling
  );
  const userId = user.id;
  const previousPlayers = players.map((player) => ({ ...player }));
  const now = new Date();
  const currentExpiry = getContractExpiration(negotiationPlayer);
  const baseDate =
    currentExpiry && currentExpiry.getTime() > now.getTime()
      ? currentExpiry
      : now;
  const newExpiry = addMonths(baseDate, CONTRACT_EXTENSION_MONTHS);

  const confidence = negotiationConfidenceFromOffer(
    clampedOffer,
    salaryNegotiationProfile,
    negotiationPlayer
  );

  const updatedPlayers = players.map((player) => {
    if (player.id !== negotiationPlayer.id) {
      return player;
    }
    const currentContract = player.contract ?? {
      expiresAt: newExpiry.toISOString(),
      status: "active" as const,
      salary: clampedOffer,
      extensions: 0,
    };
    return {
      ...player,
      contract: {
        ...currentContract,
        salary: clampedOffer,
        expiresAt: newExpiry.toISOString(),
        status: "active" as const,
        extensions: (currentContract.extensions ?? 0) + 1,
      },
      motivation: clampPerformanceGauge(
        player.motivation + Math.min(0.08, confidence * 0.2),
        DEFAULT_GAUGE_VALUE
      ),
    };
  });

  const normalized = normalizePlayers(updatedPlayers);
  setPlayers(normalized);
  setIsNegotiatingSalary(true);
  try {
    await saveTeamPlayers(userId, normalized);
    toast.success(
      t("teamPlanning.toasts.negotiationSuccess", {
        name: negotiationPlayer.name,
        salary: formatSalary(clampedOffer),
        months: CONTRACT_EXTENSION_MONTHS,
      })
    );
    finalizeContractDecision(negotiationPlayer.id);
    setNegotiationPlayerId(null);
    resetNegotiationState();
  } catch (error) {
    console.error("[TeamPlanning] salary negotiation failed", error);
    toast.error(t("teamPlanning.toasts.negotiationFailed"));
    setPlayers(previousPlayers);
  } finally {
    setIsNegotiatingSalary(false);
  }
};

const handleConfirmSalaryNegotiation = async () => {
  if (!user || !negotiationPlayer || !salaryNegotiationProfile) {
    return;
  }
  if (isFinalCounterStage && playerCounterOffer !== null) {
    return;
  }

  const clampedOffer = clampNumber(
    Math.round(negotiationOffer),
    salaryNegotiationProfile.floor,
    salaryNegotiationProfile.ceiling
  );

  const attemptNumber = negotiationAttempts + 1;
  const acceptanceChance = negotiationConfidenceFromOffer(
    clampedOffer,
    salaryNegotiationProfile,
    negotiationPlayer
  );
  const autoAccept = clampedOffer >= salaryNegotiationProfile.demand * 0.98;
  const accepted = autoAccept || Math.random() < acceptanceChance;

  if (accepted) {
    await completeSalaryNegotiation(clampedOffer);
    return;
  }

  const counter = buildPlayerCounterOffer(
    clampedOffer,
    salaryNegotiationProfile,
    attemptNumber
  );
  const remainingAttempts = Math.max(
    MAX_NEGOTIATION_ATTEMPTS - attemptNumber,
    0
  );
  const isFinal = attemptNumber >= MAX_NEGOTIATION_ATTEMPTS;

  setNegotiationAttempts(attemptNumber);
  setPlayerCounterOffer(counter);
  setIsFinalCounterStage(isFinal);
  setNegotiationOffer(counter);

  const counterMessage = isFinal
    ? t("teamPlanning.toasts.negotiationRejectedFinal", {
        value: formatSalary(counter),
      })
    : `${t("teamPlanning.toasts.negotiationRejectedCounter", {
        value: formatSalary(counter),
      })} ${t("teamPlanning.salaryDialog.attemptsLeft", {
        value: remainingAttempts,
      })}`;
  toast.info(counterMessage);
};

const handleAcceptCounterOffer = async () => {
    if (playerCounterOffer === null) {
      return;
    }
    await completeSalaryNegotiation(playerCounterOffer);
  };

  const handleRejectCounterOffer = () => {
  toast.info(t("teamPlanning.toasts.negotiationNoResult"));
  setNegotiationPlayerId(null);
  resetNegotiationState();
};

const handleExtendContract = (playerId: string) => {
    openSalaryNegotiation(playerId);
  };

  const handleReleaseContract = async (playerId: string) => {
    if (!user || isProcessingContract) {
      return;
    }
    const userId = user.id;
    const target = players.find((player) => player.id === playerId);
    if (!target) {
      return;
    }

    const isLegendRental = getLegendIdFromPlayer(target) !== null;

    if (isLegendRental) {
      setIsProcessingContract(true);
      const previousPlayers = players.map((player) => ({ ...player }));
      const updatedPlayers = players.filter((player) => player.id !== playerId);

      setPlayers(updatedPlayers);
      try {
        await completeLegendRental(userId, playerId, {
          players: previousPlayers,
        });
        toast.info(t("teamPlanning.toasts.rentalEnded", { name: target.name }));
        finalizeContractDecision(playerId);
      } catch (error) {
        console.error("[TeamPlanning] legend rental release failed", error);
        toast.error(t("teamPlanning.errors.contractReleaseFailed"));
        setPlayers(previousPlayers);
      } finally {
        setIsProcessingContract(false);
      }
      return;
    }

    setIsProcessingContract(true);
    const previousPlayers = players.map((player) => ({ ...player }));
    const updatedPlayers = players.map((player) => {
      if (player.id !== playerId) {
        return player;
      }
      const currentContract = player.contract ?? {
        expiresAt: new Date().toISOString(),
        status: "expired",
        salary: 0,
        extensions: 0,
      };
      return {
        ...player,
        squadRole:
          player.squadRole === "starting" ? "reserve" : player.squadRole,
        contract: {
          ...currentContract,
          status: "released" as const,
        },
        market: {
          ...(player.market ?? { active: false, listingId: null }),
          active: true,
        },
      };
    });

    setPlayers(updatedPlayers);
    try {
      await saveTeamPlayers(userId, updatedPlayers);
      toast.info(t("teamPlanning.toasts.releasedToMarket", { name: target.name }));
      finalizeContractDecision(playerId);
    } catch (error) {
      console.error("[TeamPlanning] release contract failed", error);
      toast.error(t("teamPlanning.errors.contractReleaseFailed"));
      setPlayers(previousPlayers);
    } finally {
      setIsProcessingContract(false);
    }
  };

  const handleFirePlayer = async (playerId: string) => {
    if (!user) {
      return;
    }

    const userId = user.id;
    const target = players.find((player) => player.id === playerId);
    if (!target) {
      return;
    }

    const previousPlayers = players.map((player) => ({ ...player }));
    const updatedPlayers = players.filter((player) => player.id !== playerId);

    setPlayers(updatedPlayers);
    try {
      await saveTeamPlayers(user.id, updatedPlayers);
      removePlayerFromCustomFormations(playerId);
      toast.success(t("teamPlanning.toasts.playerFired", { name: target.name }));
      finalizeContractDecision(playerId);
    } catch (error) {
      console.error("[TeamPlanning] fire player failed", error);
      toast.error(t("teamPlanning.errors.playerFireFailed"));
      setPlayers(previousPlayers);
    }
  };

  const getPitchCoordinates = useCallback(
    (clientX: number, clientY: number): FormationPlayerPosition | null => {
      const field = pitchRef.current;
      if (!field) {
        return null;
      }
      const rect = field.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return null;
      }

      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null;
      }

      const relativeX = ((clientX - rect.left) / rect.width) * 100;
      const relativeY = ((clientY - rect.top) / rect.height) * 100;

      // Pure 0-100 Mapping (No Padding)
      // Game coordinates directly match visual percentages now.

      let gameY = 100 - relativeX;
      let gameX = relativeY;

      return {
        x: clampPercentageValue(gameX),
        y: clampPercentageValue(gameY),
        position: "CM",
      };
    },
    []
  );

  const applyManualPosition = useCallback(
    (
      playerId: string,
      data: FormationPlayerPosition,
      formationName = selectedFormation
    ) => {
      const normalized: FormationPlayerPosition = {
        x: clampPercentageValue(data.x),
        y: clampPercentageValue(data.y),
        position: data.position,
        ...(typeof data.zoneId === "string" && data.zoneId.trim()
          ? { zoneId: data.zoneId.trim() }
          : {}),
      };
      updatePlayerManualPosition(formationName, playerId, normalized);
      setManualSlotPositions((prev) => {
        const current = prev[playerId];
        if (
          current &&
          current.x === normalized.x &&
          current.y === normalized.y &&
          current.position === normalized.position &&
          current.zoneId === normalized.zoneId
        ) {
          return prev;
        }
        return {
          ...prev,
          [playerId]: normalized,
        };
      });
    },
    [selectedFormation, updatePlayerManualPosition]
  );

  const handlePitchMarkerDragStart = useCallback(
    (player: Player, event: React.DragEvent<HTMLDivElement>) => {
      setDraggedPlayerId(player.id);
      event.dataTransfer.setData("text/plain", player.id);
      event.dataTransfer.effectAllowed = "move";

      // Auto-collapse list on drag start for focus mode
      setIsListCollapsed(true);
    },
    []
  );

  // Removed duplicate getPitchMetricValue

  const renderPitchTooltip = useCallback(
  (player: DisplayPlayer) => (
    <div className="space-y-2">
      <div className="text-xs font-semibold">{player.name}</div>
      <PerformanceGauge
        label={getMetricLabel("power")}
        value={getPlayerPower(player)}
        variant="dark"
      />
      <PerformanceGauge
        label={getMetricLabel("health")}
        value={getPlayerHealth(player)}
        variant="dark"
      />
      <PerformanceGauge
        label={getMetricLabel("condition")}
        value={getPlayerCondition(player)}
        variant="dark"
      />
      <PerformanceGauge
        label={getMetricLabel("motivation")}
        value={getPlayerMotivation(player)}
        variant="dark"
      />
      {player.originalOverall > player.overall ? (
        <div className="text-[11px] text-muted-foreground">
          {t("teamPlanning.pitchTooltip.originalCurrent", {
            original: formatRatingLabel(player.originalOverall),
            current: formatRatingLabel(player.overall),
          })}
        </div>
      ) : null}
    </div>
  ),
  [t]
);

const handleListForTransfer = (playerId: string) => {
    navigate("/transfer-market", { state: { listPlayerId: playerId } });
  };

  const handleReleasePlayer = (playerId: string) => {
    let removedName: string | null = null;
    removePlayerFromCustomFormations(playerId);
    setPlayers((prev) => {
      const player = prev.find((p) => p.id === playerId);
      if (!player) {
        return prev;
      }
      removedName = player.name;
      return prev.filter((p) => p.id !== playerId);
    });
    if (removedName) {
      setFocusedPlayerId((current) => (current === playerId ? null : current));
      toast.success(t("teamPlanning.toasts.playerReleased", { name: removedName }), {
        description: t("teamPlanning.toasts.saveReminder"),
      });
    }
  };

  const handleSave = async () => {
  if (!user) return;
  try {
    const collectIds = (role: Player["squadRole"]) =>
      players
        .filter((p) => p.squadRole === role && p.id)
        .map((p) => String(p.id));

    const unique = (ids: string[]) =>
      Array.from(new Set(ids.filter(Boolean)));

    const starters = unique(collectIds("starting"));
    if (starters.length !== 11) {
      toast.error(t("teamPlanning.errors.lineupIncomplete"), {
        description: t("teamPlanning.errors.lineupIncompleteDescription"),
      });
      return;
    }

    const currentLineupReadinessIssues =
      getLineupReadinessIssues(startingEleven);
    if (currentLineupReadinessIssues.length > 0) {
      setIsLineupReadinessOpen(true);
      return;
    }

    const bench = unique(collectIds("bench")).filter(
      (id) => !starters.includes(id)
    );
    const reserves = unique(collectIds("reserve")).filter(
      (id) => !starters.includes(id) && !bench.includes(id)
    );

    const startersSet = new Set(starters);
    const starterPlayersForSave = displayPlayers.filter((player) =>
      startersSet.has(player.id)
    );
    if (
      hasFreeFormationOverlap(resolvedCurrentSlotAssignments) ||
      countGoalkeeperZoneAssignments(resolvedCurrentSlotAssignments) !== 1
    ) {
      toast.error(t("teamPlanning.errors.positionUpdateFailed"), {
        description: "Dizilişte üst üste binen oyuncu ya da geçersiz kaleci yerleşimi var.",
      });
      return;
    }

    const customForSave = Object.fromEntries(
      Object.entries(customFormations).flatMap(([formationKey, layout]) => {
        if (!layout || typeof layout !== "object") {
          return [];
        }

        const filteredLayout = Object.fromEntries(
          Object.entries(layout).filter(([playerId]) => startersSet.has(playerId))
        ) as Record<string, FormationPlayerPosition>;
        const isSelectedFormation = formationKey === selectedFormation;
        const effectiveLayout = isSelectedFormation
          ? {
              ...filteredLayout,
              ...manualSlotPositions,
            }
          : filteredLayout;

        if (
          starterPlayersForSave.length === 0 ||
          Object.keys(effectiveLayout).length === 0
        ) {
          return [];
        }

        const normalizedAssignments = buildFreeFormationAssignments({
          formation: formationKey,
          players: starterPlayersForSave,
          starters: starterPlayersForSave.map((player) => player.id),
          manualLayout: effectiveLayout,
        });
        if (normalizedAssignments.length === 0) {
          return [];
        }

        const sanitizedLayout = buildFreeFormationLayoutRecord(normalizedAssignments);
        return [[formationKey, sanitizedLayout]];
      })
    ) as CustomFormationState;

    const fallbackShape = derivedFormationShape ?? selectedFormation;
    const shapeForSave = fallbackShape.trim();

    await saveTeamPlayers(user.id, players, {
      formation: selectedFormation,
      shape: shapeForSave,
      squads: {
        starters,
        bench,
        reserves,
      },
      slotAssignments: resolvedCurrentSlotAssignments,
      customFormations:
        Object.keys(customForSave).length > 0 ? customForSave : undefined,
    });

    setSavedFormationShape(shapeForSave);
    toast.success(t("teamPlanning.toasts.saveSuccess"));
  } catch (error) {
    console.error("[TeamPlanning] saveTeamPlayers failed", error);
    const description =
      error &&
      typeof error === "object" &&
      "details" in error &&
      typeof (error as { details?: unknown }).details === "string"
        ? String((error as { details?: unknown }).details)
        : error &&
          typeof error === "object" &&
          "message" in error &&
          typeof (error as { message?: unknown }).message === "string"
        ? String((error as { message?: unknown }).message)
        : t("teamPlanning.errors.saveServerDescription");
    toast.error(t("teamPlanning.errors.saveServer"), { description });
  }
};

const activeUserId = user?.id ?? null;

  useEffect(() => {
    if (!activeUserId) {
      setBootstrappedUserId(null);
    }
  }, [activeUserId]);

  useEffect(() => {
    if (!user || !activeUserId) return;
    if (bootstrappedUserId === activeUserId) {
      return;
    }
    let isMounted = true;
    (async () => {
      const preferredTeamName =
        (user.teamName?.includes("@")
          ? user.teamName.split("@")[0]
          : user.teamName) || t("common.teamFallback");
      const managerName = user.username || preferredTeamName;

      let team: Awaited<ReturnType<typeof getTeam>> | null = null;
      try {
        team = await getTeam(user.id);
      } catch (error) {
        console.error("[TeamPlanning] getTeam failed", error);
        toast.error(t("teamPlanning.errors.teamLoad"));
        return;
      }

      if (!team) {
        try {
          await auth.currentUser?.getIdToken(true).catch((err) => {
            console.warn(
              "[TeamPlanning] token refresh before team create failed",
              err
            );
          });
          team = await createInitialTeam(
            user.id,
            preferredTeamName,
            managerName,
            {
              authUser: auth.currentUser,
            }
          );
        } catch (error) {
          console.error("[TeamPlanning] createInitialTeam failed", error);
          toast.error(t("teamPlanning.errors.teamCreate"));
          return;
        }
      }

      if (!isMounted) {
        return;
      }

      teamLeagueIdRef.current =
        typeof (team as { leagueId?: string | null } | null)?.leagueId ===
        "string"
          ? (team as { leagueId?: string | null }).leagueId
          : null;

      const rawStartingCount = team.players.filter(
        (player) => player.squadRole === "starting"
      ).length;
      const normalized = normalizePlayers(team.players);
      const normalizedStartingCount = normalized.filter(
        (player) => player.squadRole === "starting"
      ).length;
      setPlayers(normalized);

      if (rawStartingCount > normalizedStartingCount) {
        toast.warning(t("teamPlanning.toasts.lineupAdjusted"), {
          description: t("teamPlanning.toasts.duplicateOverflow"),
        });
      }

      const remoteFormation =
        team.plan?.formation || team.lineup?.formation || formations[0].name;
      setSelectedFormation(remoteFormation);

      const remoteCustomFormations = sanitizeCustomFormationState(
        team.plan?.customFormations || team.lineup?.customFormations || {}
      );
      setCustomFormations(remoteCustomFormations);

      const rawPlanShape =
        typeof team.plan?.shape === "string" ? team.plan.shape.trim() : "";
      const rawLineupShape =
        typeof team.lineup?.shape === "string" ? team.lineup.shape.trim() : "";
      const normalizedShape =
        rawPlanShape && rawPlanShape.toLowerCase() !== "auto"
          ? rawPlanShape
          : rawLineupShape && rawLineupShape.toLowerCase() !== "auto"
          ? rawLineupShape
          : "";
      setSavedFormationShape(normalizedShape || null);
      setBootstrappedUserId(activeUserId);
    })();
    return () => {
      isMounted = false;
    };
  }, [activeUserId, bootstrappedUserId, user]);

  useEffect(() => {
    if (players.length === 0) {
      if (focusedPlayerId !== null) {
        setFocusedPlayerId(null);
      }
      return;
    }
    if (focusedPlayerId && players.some((p) => p.id === focusedPlayerId)) {
      return;
    }
    const fallback =
      players.find((p) => p.squadRole === "starting") ?? players[0];
    if (fallback && fallback.id !== focusedPlayerId) {
      setFocusedPlayerId(fallback.id);
    }
  }, [players, focusedPlayerId]);

  useEffect(() => {
    if (renamePlayer) {
      setRenameInput(renamePlayer.name);
    } else {
      setRenameInput("");
    }
  }, [renamePlayer]);

  useEffect(() => {
    const expiredIds = new Set(
      players
        .filter((player) => isContractExpired(player))
        .map((player) => player.id)
    );

    handledContractsRef.current.forEach((id) => {
      if (!expiredIds.has(id)) {
        handledContractsRef.current.delete(id);
      }
    });

    setPendingContractIds((prev) => {
      const existing = new Set(prev);
      const next = [...prev];
      players.forEach((player) => {
        if (!expiredIds.has(player.id)) {
          return;
        }
        if (handledContractsRef.current.has(player.id)) {
          return;
        }
        if (!existing.has(player.id)) {
          next.push(player.id);
        }
      });
      return next;
    });
  }, [players]);

  useEffect(() => {
    if (pendingContractIds.length === 0) {
      setActiveContractId(null);
      return;
    }
    setActiveContractId((prev) =>
      prev && pendingContractIds.includes(prev) ? prev : pendingContractIds[0]
    );
  }, [pendingContractIds]);

  useEffect(() => {
    if (players.length === 0) {
      return;
    }

    const startingIds = new Set(
      players
        .filter((player) => player.squadRole === "starting")
        .map((player) => player.id)
    );

    setCustomFormations((prev) => {
      let changed = false;
      const next: CustomFormationState = {};

      Object.entries(prev).forEach(([formationKey, layout]) => {
        const filteredEntries = Object.entries(layout).filter(([playerId]) =>
          startingIds.has(playerId)
        );

        if (filteredEntries.length > 0) {
          next[formationKey] = Object.fromEntries(filteredEntries);
          if (filteredEntries.length !== Object.keys(layout).length) {
            changed = true;
          }
        } else if (Object.keys(layout).length > 0) {
          changed = true;
        }
      });

      if (!changed) {
        return prev;
      }

      return next;
    });

    setManualSlotPositions((prev) => {
      const entries = Object.entries(prev).filter(([playerId]) =>
        startingIds.has(playerId)
      );
      if (entries.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(entries);
    });
  }, [players]);

  const startingEleven = displayPlayers.filter(
    (p) => p.squadRole === "starting"
  );
  const benchPlayers = displayPlayers.filter((p) => p.squadRole === "bench");
  const reservePlayers = displayPlayers.filter(
    (p) => p.squadRole === "reserve"
  );
  const hasStartingVacancy = startingEleven.length < 11;
  const getMoveToStartingLabel = useCallback(
    (_player: Pick<Player, "position">) =>
      hasStartingVacancy
        ? t("common.playerCard.moveToStarting")
        : t("common.playerCard.moveToStarting"),
    [hasStartingVacancy, t]
  );

  const currentFormation =
    formations.find((f) => f.name === selectedFormation) ?? formations[0];
  const manualFormation = useMemo(
    () => customFormations[selectedFormation] ?? {},
    [customFormations, selectedFormation]
  );
  const currentFormationSlotTemplates = useMemo(
    () =>
      currentFormation.positions.map((slot, slotIndex) => ({
        ...slot,
        slotIndex,
        slotSource: "template" as const,
        zoneId: resolveSlotZoneId(slot),
        player: null,
      })),
    [currentFormation]
  );
  const effectiveManualFormation = useMemo(
    () => ({
      ...manualFormation,
      ...manualSlotPositions,
    }),
    [manualFormation, manualSlotPositions]
  );
  const startingDisplayPlayers = useMemo(
    () => displayPlayers.filter((player) => player.squadRole === "starting"),
    [displayPlayers]
  );

  useEffect(() => {
    syncManualSlotsForFormation(selectedFormation);
  }, [selectedFormation, syncManualSlotsForFormation]);

  const resolvedCurrentSlotAssignments = useMemo(
    () =>
      buildFreeFormationAssignments({
        formation: selectedFormation,
        players: startingDisplayPlayers,
        starters: startingDisplayPlayers.map((player) => player.id),
        manualLayout: effectiveManualFormation,
      }),
    [effectiveManualFormation, selectedFormation, startingDisplayPlayers]
  );
  const formationPositions: PitchSlot[] = useMemo(() => {
    const startingById = new Map(
      startingDisplayPlayers.map((player) => [player.id, player] as const)
    );
    const starterSlots = resolvedCurrentSlotAssignments.map((assignment) => ({
      slotIndex: assignment.slotIndex,
      slotKey: `${assignment.slotIndex}-${assignment.playerId}`,
      position: assignment.position,
      x: assignment.x,
      y: assignment.y,
      slotSource: effectiveManualFormation[assignment.playerId]
        ? ("manual" as const)
        : ("template" as const),
      zoneId: assignment.zoneId,
      rect: currentFormation.positions[assignment.slotIndex]?.rect,
      player: startingById.get(assignment.playerId) ?? null,
    }));

    const placeholders = currentFormationSlotTemplates
      .slice(starterSlots.length)
      .map((slot) => ({
        ...slot,
        slotKey: `${slot.slotIndex}-${slot.slotKey ?? "template"}`,
      }));

    return [...starterSlots, ...placeholders];
  }, [
    currentFormation.positions,
    currentFormationSlotTemplates,
    effectiveManualFormation,
    resolvedCurrentSlotAssignments,
    startingDisplayPlayers,
  ]);
  const emptyFormationSlots = useMemo(
    () => formationPositions.filter((slot) => !slot.player),
    [formationPositions]
  );
  const dragSlotHighlights = useMemo<DragSlotHighlight[]>(() => [], []);
  const autoFillAssignments = useMemo<AutoFillAssignment[]>(() => {
    if (emptyFormationSlots.length === 0) {
      return [];
    }

    const eligiblePlayers = displayPlayers.filter((player) => {
      if (player.squadRole !== "bench" && player.squadRole !== "reserve") {
        return false;
      }
      if (player.injuryStatus === "injured") {
        return false;
      }
      if (player.contract?.status === "released") {
        return false;
      }
      if (isContractExpired(player)) {
        return false;
      }
      return true;
    });

    if (eligiblePlayers.length === 0) {
      return [];
    }

    const slotCandidates = emptyFormationSlots
      .map((slot) => {
        const zoneId = resolveFormationSlotZoneId(slot);
        const candidates = recommendPlayers(zoneId, eligiblePlayers, {
          limit: eligiblePlayers.length,
        });
        return { slot, zoneId, candidates };
      })
      .sort((left, right) => {
        const countDelta = left.candidates.length - right.candidates.length;
        if (countDelta !== 0) {
          return countDelta;
        }
        return left.slot.slotIndex - right.slot.slotIndex;
      });

    const usedPlayerIds = new Set<string>();
    const assignments: AutoFillAssignment[] = [];

    slotCandidates.forEach(({ slot, zoneId, candidates }) => {
      const candidate = candidates.find(
        (player) => !usedPlayerIds.has(player.id)
      );
      if (!candidate) {
        return;
      }

      usedPlayerIds.add(candidate.id);
      assignments.push({
        playerId: candidate.id,
        slotIndex: slot.slotIndex,
        zoneId,
        position: slot.position,
        x: slot.x,
        y: slot.y,
      });
    });

    return assignments;
  }, [displayPlayers, emptyFormationSlots]);
  const getCurrentPitchSlotForPlayer = useCallback(
    (playerId: string) =>
      formationPositions.find((entry) => entry.player?.id === playerId) ?? null,
    [formationPositions]
  );
  const isPlayerGoalkeeper = useCallback(
    (player: Player) => {
      const naturalPosition = playerBaselineRef.current[player.id]?.naturalPosition;
      return (
        canonicalPosition(naturalPosition ?? player.position) === "GK" ||
        (player.roles ?? []).some((role) => canonicalPosition(role) === "GK")
      );
    },
    []
  );

  const validatePitchPlacement = useCallback(
    (player: Player, point: FormationPlayerPosition) => {
      const normalizedPoint = normalizeFreeFormationPoint(point);
      const otherAssignments = resolvedCurrentSlotAssignments.filter(
        (assignment) => assignment.playerId !== player.id
      );
      const overlap = findOverlappingAssignment(normalizedPoint, otherAssignments, {
        ignorePlayerId: player.id,
      });

      if (overlap) {
        toast.error(t("teamPlanning.errors.positionUpdateFailed"), {
          description: "Oyuncular üst üste gelemez.",
        });
        return null;
      }

      const targetIsGoalkeeper = normalizedPoint.zoneId === "kaleci";
      if (isPlayerGoalkeeper(player) !== targetIsGoalkeeper) {
        if (isPlayerGoalkeeper(player)) {
          toast.warning(t("teamPlanning.errors.goalkeeperMismatch"));
        } else {
          toast.warning(t("teamPlanning.errors.goalkeeperFull"));
        }
        return null;
      }

      const goalkeeperCount = countGoalkeeperZoneAssignments([
        ...otherAssignments,
        {
          playerId: player.id,
          slotIndex: otherAssignments.length,
          x: normalizedPoint.x,
          y: normalizedPoint.y,
          position: normalizedPoint.position,
          zoneId: normalizedPoint.zoneId,
        },
      ]);
      if (goalkeeperCount !== 1) {
        toast.warning(t("teamPlanning.errors.goalkeeperFull"));
        return null;
      }

      return normalizedPoint;
    },
    [isPlayerGoalkeeper, resolvedCurrentSlotAssignments, t]
  );

  const placePlayerOnPitch = useCallback(
    (playerId: string, point: FormationPlayerPosition) => {
      const player = players.find((current) => current.id === playerId);
      if (!player) {
        return false;
      }

      const normalizedPoint = validatePitchPlacement(player, point);
      if (!normalizedPoint) {
        return false;
      }

      if (player.squadRole === "starting") {
        setPlayers((prev) =>
          normalizePlayers(
            prev.map((current) =>
              current.id === playerId
                ? { ...current, position: normalizedPoint.position }
                : current
            )
          )
        );
        applyManualPosition(playerId, normalizedPoint);
        setFocusedPlayerId(playerId);
        toast.success(t("teamPlanning.toasts.repositionSuccess"));
        return true;
      }

      const starters = players.filter(
        (current) => current.squadRole === "starting"
      ).length;
      if (starters >= 11) {
        toast.error(t("teamPlanning.errors.positionUpdateFailed"), {
          description: t("teamPlanning.errors.startingLineupFull"),
        });
        return false;
      }

      let errorMessage: string | null = null;
      let updated = false;

      setPlayers((prev) => {
        const promotion = promotePlayerToStartingRoster(
          prev,
          playerId,
          normalizedPoint.position
        );
        if (promotion.error) {
          errorMessage = promotion.error;
          return prev;
        }
        if (!promotion.updated) {
          return prev;
        }
        updated = true;
        return promotion.players;
      });

      if (errorMessage) {
        toast.error(t("teamPlanning.errors.playerAddFailed"), {
          description: errorMessage,
        });
        return false;
      }

      if (!updated) {
        return false;
      }

      applyManualPosition(playerId, normalizedPoint);
      setFocusedPlayerId(playerId);
      toast.success(t("teamPlanning.toasts.placeSuccess"));
      return true;
    },
    [applyManualPosition, players, t, validatePitchPlacement]
  );

  const handlePitchDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const playerId = event.dataTransfer.getData("text/plain") || draggedPlayerId;
      if (!playerId) {
        return;
      }

      const coordinates = getPitchCoordinates(event.clientX, event.clientY);
      if (!coordinates) {
        setDraggedPlayerId(null);
        return;
      }

      dropHandledRef.current = true;
      placePlayerOnPitch(playerId, coordinates);
      setDraggedPlayerId(null);
    },
    [draggedPlayerId, getPitchCoordinates, placePlayerOnPitch]
  );

  const handlePlayerDragEnd = useCallback(
    (player: Player, event: React.DragEvent<HTMLDivElement>) => {
      setDraggedPlayerId(null);
      if (dropHandledRef.current) {
        dropHandledRef.current = false;
        return;
      }

      if (event.clientX === 0 && event.clientY === 0) {
        return;
      }

      const coordinates = getPitchCoordinates(event.clientX, event.clientY);
      if (!coordinates) {
        return;
      }

      placePlayerOnPitch(player.id, coordinates);
    },
    [getPitchCoordinates, placePlayerOnPitch]
  );

  const derivedFormationShape = useMemo(
    () => deriveFormationShape(formationPositions),
    [formationPositions]
  );
  const formationTriggerLabel = useMemo(() => {
    if (
      derivedFormationShape &&
      derivedFormationShape.trim() &&
      derivedFormationShape !== selectedFormation
    ) {
      return `Serbest: ${derivedFormationShape}`;
    }
    return selectedFormation || t("teamPlanning.page.formationPlaceholder");
  }, [derivedFormationShape, selectedFormation, t]);

  const selectedPlayer = useMemo(() => {
    if (!focusedPlayerId) return null;
    return displayPlayers.find((p) => p.id === focusedPlayerId) ?? null;
  }, [displayPlayers, focusedPlayerId]);

  const lineupReadinessIssues = useMemo(
    () => getLineupReadinessIssues(startingEleven),
    [startingEleven]
  );

  const handleBackNavigation = useCallback(() => {
    const currentLineupReadinessIssues =
      getLineupReadinessIssues(startingEleven);
    if (currentLineupReadinessIssues.length > 0) {
      setIsLineupReadinessOpen(true);
      return;
    }

    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/");
  }, [navigate, startingEleven]);

  useEffect(() => {
    if (isLineupReadinessOpen && lineupReadinessIssues.length === 0) {
      setIsLineupReadinessOpen(false);
    }
  }, [isLineupReadinessOpen, lineupReadinessIssues.length]);

  useEffect(() => {
    if (isKitUsageOpen || !resumeLineupReadinessAfterKit) {
      return;
    }

    setResumeLineupReadinessAfterKit(false);
    if (lineupReadinessIssues.length > 0) {
      setIsLineupReadinessOpen(true);
    }
  }, [isKitUsageOpen, lineupReadinessIssues, resumeLineupReadinessAfterKit]);

  const openKitUsageForPlayer = useCallback(
    (playerId: string, options?: { reopenLineupReadiness?: boolean }) => {
      setKitUsagePlayerId(playerId);
      setIsDetailOverlayOpen(false);
      setIsLineupReadinessOpen(false);
      setResumeLineupReadinessAfterKit(Boolean(options?.reopenLineupReadiness));
      setIsKitUsageOpen(true);
    },
    [t]
  );

  const handleOpenKitUsage = useCallback(
    (playerId: string) => {
      openKitUsageForPlayer(playerId);
    },
    [openKitUsageForPlayer]
  );

  const handleKitUsageOpenChange = useCallback((open: boolean) => {
    setIsKitUsageOpen(open);
    if (!open) {
      setKitUsagePlayerId(null);
    }
  }, []);

  const handleKitApplied = useCallback((updatedPlayers: Player[]) => {
    if (updatedPlayers.length === 0) {
      return;
    }

    const updatedPlayerMap = new Map(
      updatedPlayers.map((player) => [String(player.id), player])
    );
    const lastUpdatedPlayer = updatedPlayers[updatedPlayers.length - 1];

    setFocusedPlayerId(lastUpdatedPlayer.id);
    setPlayers((prev) =>
      normalizePlayers(
        prev.map((player) =>
          updatedPlayerMap.has(String(player.id))
            ? { ...player, ...updatedPlayerMap.get(String(player.id))! }
            : player
        )
      )
    );
  }, []);

  const handleOpenLineupIssueKitUsage = useCallback(
    (playerId: string) => {
      openKitUsageForPlayer(playerId, { reopenLineupReadiness: true });
    },
    [openKitUsageForPlayer]
  );

  const handleBenchLineupIssuePlayer = (playerId: string) => {
    movePlayer(playerId, "bench");
  };

  const selectedZoneDefinition = useMemo(() => {
    if (!selectedSlotMeta) {
      return null;
    }
    return getZoneDefinition(selectedSlotMeta.zoneId);
  }, [selectedSlotMeta]);

  const recommendedPlayers: DisplayPlayer[] = useMemo(() => {
    if (!selectedSlotMeta) {
      return [];
    }
    return recommendPlayers(selectedSlotMeta.zoneId, displayPlayers, {
      excludeIds: selectedPlayer ? [selectedPlayer.id] : undefined,
      limit: 6,
    });
  }, [displayPlayers, selectedPlayer, selectedSlotMeta]);

  const handleSlotSelect = useCallback(
    (slot: PitchSlot) => {
      setSelectedSlotMeta({
        slotIndex: slot.slotIndex,
        zoneId: resolveFormationSlotZoneId(slot),
        x: slot.x,
        y: slot.y,
        position: slot.position,
      });
      setFocusedPlayerId(slot.player ? slot.player.id : null);
      setActiveTab("suggestions");
    },
    [setFocusedPlayerId]
  );

  const getPitchMetricValue = useCallback(
    (player: Player, metric: MetricKey) => {
      let value = 0;
      if (metric === "power") {
        const index = calculatePowerIndex(player);
        value = normalizeRatingTo100(index);

        // Apply position affinity penalty
        const slot = formationPositions.find((s) => s.player?.id === player.id);
        if (slot) {
          const zoneId = resolveFormationSlotZoneId(slot);
          const zone = getZoneDefinition(zoneId);
          // Cast to DisplayPlayer is safe here as positionAffinity only checks position/roles
          // which exist on Player.
          // Note: affinity returns 0.5 for mismatch, 1.2 for exact match.
          // The user requested "80 becomes 40", so direct multiplier is good.
          // So 0.5 is key.
          const affinity = positionAffinity(player as any, zone);
          value = value * affinity;
        }
      } else {
        switch (metric) {
          case "health":
            value = (player.health ?? 0) * 100;
            break;
          case "condition":
            value = (player.condition ?? 0) * 100;
            break;
          case "motivation":
            value = (player.motivation ?? 0) * 100;
            break;
        }
      }
      return value;
    },
    [formationPositions]
  );

  useEffect(() => {
    if (!focusedPlayerId) {
      return;
    }
    const slot = formationPositions.find(
      (entry) => entry.player?.id === focusedPlayerId
    );
    if (!slot) {
      return;
    }
    setSelectedSlotMeta((prev) => {
      if (prev && prev.slotIndex === slot.slotIndex) {
        return prev;
      }
      return {
        slotIndex: slot.slotIndex,
        zoneId: resolveFormationSlotZoneId(slot),
        x: slot.x,
        y: slot.y,
        position: slot.position,
      };
    });
  }, [focusedPlayerId, formationPositions]);

  useEffect(() => {
    setSelectedSlotMeta((prev) => {
      if (!prev) {
        return prev;
      }
      const slot = formationPositions.find(
        (entry) => entry.slotIndex === prev.slotIndex
      );
      if (!slot) {
        return null;
      }
      const nextZone = resolveFormationSlotZoneId(slot);
      if (
        slot.x === prev.x &&
        slot.y === prev.y &&
        slot.position === prev.position &&
        prev.zoneId === nextZone
      ) {
        return prev;
      }
      return {
        slotIndex: slot.slotIndex,
        zoneId: nextZone,
        x: slot.x,
        y: slot.y,
        position: slot.position,
      };
    });
  }, [formationPositions]);

  const handleFormationSelect = useCallback(
    (formationName: string) => {
      setSelectedFormation(formationName);
      setSavedFormationShape(formationName);
      syncManualSlotsForFormation(formationName);
    },
    [syncManualSlotsForFormation]
  );

  const handleAutoFill = useCallback(() => {
    if (emptyFormationSlots.length === 0) {
      toast.info(t("teamPlanning.errors.emptyNoSlots"));
      return;
    }

    if (autoFillAssignments.length === 0) {
      toast.warning(t("teamPlanning.errors.noSuitablePlayer"), {
        description: t("teamPlanning.errors.noSuitablePlayerDescription"),
      });
      return;
    }

    let nextPlayers = players;
    const appliedAssignments: AutoFillAssignment[] = [];

    autoFillAssignments.forEach((assignment) => {
      const result = promotePlayerToStartingRoster(
        nextPlayers,
        assignment.playerId,
        assignment.position
      );
      if (result.error || !result.updated) {
        return;
      }
      nextPlayers = result.players;
      appliedAssignments.push(assignment);
    });

    if (appliedAssignments.length === 0) {
      toast.warning(t("teamPlanning.errors.emptyNoMatch"));
      return;
    }

    setPlayers(nextPlayers);
    appliedAssignments.forEach((assignment) => {
      removePlayerFromFormationLayout(assignment.playerId);
    });

    setActiveTab("starting");

    const remainingSlots = Math.max(
      0,
      emptyFormationSlots.length - appliedAssignments.length
    );
    if (remainingSlots > 0) {
      toast.success(
        t("teamPlanning.toasts.emptyFilledPartial", {
          count: appliedAssignments.length,
          missing: remainingSlots,
        })
      );
      return;
    }

    toast.success(t("teamPlanning.toasts.emptyFilledAll"));
  }, [
    autoFillAssignments,
    emptyFormationSlots.length,
    players,
    removePlayerFromFormationLayout,
    t,
  ]);

  const handleBestLineupAutoArrange = useCallback(() => {
    const result = buildBestLineupForFormation(
      players,
      currentFormation,
      playerBaselineRef.current
    );

    if (result.eligiblePlayerCount === 0 || result.assignments.length === 0) {
      toast.warning(t("teamPlanning.errors.bestLineupFailed"), {
        description: t("teamPlanning.errors.bestLineupFailedDescription"),
      });
      return;
    }

    setPlayers(result.players);
    clearFormationManualLayout(selectedFormation);
    setSelectedSlotMeta(null);
    setFocusedPlayerId(null);
    setActiveTab("starting");

    toast.success(
      t("teamPlanning.toasts.bestLineupSuccess", {
        count: result.assignments.length,
        missing: result.missingSlotCount,
      })
    );
  }, [clearFormationManualLayout, currentFormation, players, selectedFormation, t]);

  const handlePositionDrop = (
    e: React.DragEvent<HTMLDivElement>,
    slot: PitchSlot
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const playerId = e.dataTransfer.getData("text/plain") || draggedPlayerId;
    if (!playerId) {
      return;
    }

    const dropCoordinates =
      getPitchCoordinates(e.clientX, e.clientY) ??
      ({
        x: slot.x,
        y: slot.y,
        position: slot.position,
        zoneId: slot.zoneId,
      } satisfies FormationPlayerPosition);

    dropHandledRef.current = true;
    if (!placePlayerOnPitch(playerId, dropCoordinates)) {
      setDraggedPlayerId(null);
      return;
    }
    setDraggedPlayerId(null);
  };

  const handleAlternativeSelection = (alternativeId: string) => {
    if (!selectedSlotMeta) {
      toast.error(t("teamPlanning.errors.selectSlot"), {
        description: t("teamPlanning.errors.selectSlotDescription"),
      });
      return;
    }

    const fallbackPosition = selectedPlayer
      ? canonicalPosition(selectedPlayer.position)
      : canonicalPosition(selectedSlotMeta.position);
    const replacementPosition =
      selectedZoneDefinition?.slotPosition ?? fallbackPosition;

    const manualLayouts = selectedPlayer
      ? Object.entries(customFormations).reduce<
          Array<{ formation: string; layout: FormationPlayerPosition }>
        >((acc, [formationKey, layout]) => {
          const entry = layout?.[selectedPlayer.id];
          if (entry) {
            acc.push({ formation: formationKey, layout: entry });
          }
          return acc;
        }, [])
      : [];

    let errorMessage: string | null = null;
    let updated = false;
    let swappedPlayerId: string | null = null;

    setPlayers((prev) => {
      const result = promotePlayerToStartingRoster(
        prev,
        alternativeId,
        replacementPosition,
        {
          targetPlayerId: selectedPlayer?.id,
        }
      );
      if (result.error) {
        errorMessage = result.error;
        return prev;
      }
      if (!result.updated) {
        return prev;
      }
      updated = true;
      swappedPlayerId = result.swappedPlayerId ?? null;
      return result.players;
    });

    if (errorMessage) {
      toast.error(t("teamPlanning.errors.playerPlaceFailed"), {
        description: errorMessage,
      });
      return;
    }
    if (!updated) {
      return;
    }

    removePlayerFromCustomFormations(alternativeId);
    manualLayouts.forEach(({ formation, layout }) => {
      applyManualPosition(
        alternativeId,
        {
          ...layout,
          position: replacementPosition,
          zoneId: selectedSlotMeta.zoneId,
        },
        formation
      );
    });
    if (selectedPlayer) {
      removePlayerFromCustomFormations(selectedPlayer.id);
    }
    if (
      swappedPlayerId &&
      (!selectedPlayer || swappedPlayerId !== selectedPlayer.id)
    ) {
      removePlayerFromCustomFormations(swappedPlayerId);
    }

    applyManualPosition(alternativeId, {
      x: selectedSlotMeta.x,
      y: selectedSlotMeta.y,
      position: replacementPosition,
      zoneId: selectedSlotMeta.zoneId,
    });

    setFocusedPlayerId(alternativeId);
    setActiveTab("starting");
    toast.success(t("teamPlanning.toasts.suggestionApplied"));
  };

  return (
    <>
      <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-black text-white">
        <header
          id="tp-topbar"
          className="flex flex-shrink-0 items-center justify-between border-b border-white/10 bg-black/30 px-5 py-0 backdrop-blur"
        >
          <div className="flex items-center gap-2.5">
            <BackButton onClick={handleBackNavigation} />
            <div>
              <h1 className="text-base font-semibold sm:text-lg">
                {t("teamPlanning.page.title")}
              </h1>
              <p className="text-[11px] text-orange-100/70 sm:text-xs">
                {t("teamPlanning.page.subtitle")}
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
                  {metricOptions.map((option) => {
                    const isActive = selectedMetric === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setSelectedMetric(option.key)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-[10px] font-semibold tracking-wide transition sm:text-[11px]",
                          isActive
                            ? "border-emerald-300 bg-emerald-400/20 text-emerald-50 shadow-[0_10px_30px_rgba(52,211,153,0.18)]"
                            : "border-white/15 bg-white/5 text-orange-50/80 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        {getMetricLabel(option.key)}
                      </button>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  onClick={handleBestLineupAutoArrange}
                  className="h-8 self-start rounded-full border border-cyan-300/40 bg-cyan-400/15 px-3 text-[10px] font-semibold tracking-wide text-cyan-50 shadow-[0_10px_30px_rgba(34,211,238,0.16)] transition hover:bg-cyan-400/25 sm:text-[11px]"
                >
                  {t("teamPlanning.page.bestLineup")}
                </Button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center">
              <Select
                value={selectedFormation}
                onValueChange={handleFormationSelect}
              >
                <SelectTrigger className="h-9 border-white/30 bg-white/10 px-3 text-xs text-white shadow-sm transition hover:bg-white/20 hover:text-white sm:text-sm w-[140px]">
                  <div className="flex min-w-0 items-center">
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    <span className="truncate">
                      {formationTriggerLabel}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {formations.map((formation) => (
                    <SelectItem key={formation.name} value={formation.name}>
                      {formation.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {emptyFormationSlots.length > 0 && (
              <Button
                size="sm"
                type="button"
                onClick={handleAutoFill}
                disabled={autoFillAssignments.length === 0}
                className="tp-topbar-button h-9 border border-white/15 bg-white/10 px-3 text-xs text-white shadow-lg transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
              >
                {t("teamPlanning.page.fillEmpty")}
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              className="tp-topbar-button bg-emerald-400 text-emerald-950 shadow-lg transition hover:bg-emerald-300 h-9 px-3 text-xs sm:text-sm"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {t("common.save")}
            </Button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden relative justify-start items-stretch">
          <section
            id="tp-left"
            style={{
              width: isListCollapsed ? "100%" : "60%",
              flex: isListCollapsed ? "0 0 100%" : "0 0 60%",
              maxWidth: isListCollapsed ? "100%" : "60%",
            }}
            className="relative h-full transition-all duration-300 ease-in-out min-w-0 bg-transparent m-0 p-0 flex flex-col shrink-0"
          >
            <div
              id="tp-pitch-wrapper"
              className="flex-1 w-full h-full bg-transparent m-0 p-0 block relative min-h-0"
            >
              <Pitch
                ref={pitchRef}
                slots={formationPositions}
                slotHighlights={dragSlotHighlights}
                onPitchDrop={handlePitchDrop}
                onPositionDrop={handlePositionDrop}
                onPlayerDragStart={(player) => {
                  setDraggedPlayerId(player.id);
                  // Zoom removed
                }}
                onPlayerDragEnd={handlePlayerDragEnd}
                onSelectPlayer={(playerId) => {
                  const items = formationPositions;
                  const slot = items.find((s) => s.player?.id === playerId);
                  if (slot) {
                    handleSlotSelect(slot);
                    setFocusedPlayerId(playerId);
                  }
                }}
                onSelectSlot={handleSlotSelect}
                focusedPlayerId={focusedPlayerId}
                draggedPlayerId={draggedPlayerId}
                selectedMetric={selectedMetric}
                getMetricValue={getPitchMetricValue}
                renderTooltip={renderPitchTooltip}
                isExpanded={isListCollapsed}
                onBackgroundClick={() => {
                  setSelectedSlotMeta(null);
                  setFocusedPlayerId(null);
                  setActiveTab("starting");
                }}
              />
            </div>
          </section>

          <aside
            className={cn(
              "flex flex-col h-full overflow-hidden border-l border-white/10 bg-black/35 transition-all duration-300 ease-in-out absolute right-0 top-0 bottom-0 z-20 shadow-2xl backdrop-blur-md",
              isListCollapsed
                ? "translate-x-[calc(100%-24px)]"
                : "translate-x-0 w-[40%]"
            )}
            onClick={(e) => {
              if (isListCollapsed) {
                e.stopPropagation();
                setIsListCollapsed(false);
              }
            }}
          >
            {isListCollapsed && (
              <div className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center bg-orange-500/20 hover:bg-orange-500/40 cursor-pointer group">
                <ChevronLeft className="w-4 h-4 text-orange-100 group-hover:scale-110 transition-transform" />
              </div>
            )}
            <div
              id="tp-right-pane"
              className="flex h-full flex-col"
              style={{ contain: "layout paint", willChange: "transform" }}
            >
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex h-full flex-col"
                style={{ contain: "layout paint", willChange: "transform" }}
              >
                <div
                  id="tp-right-header"
                  data-collapsed={isRightHeaderCollapsed}
                  className="sticky top-0 z-20 border-b border-white/10 bg-black/50 backdrop-blur"
                >
                  <div className="px-2 py-1.5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-orange-100/60" />
                        <Input
                          placeholder={t("teamPlanning.page.searchPlaceholder")}
                          value={searchTerm}
                          onChange={(event) =>
                            setSearchTerm(event.target.value)
                          }
                          className="h-6 border-white/20 bg-white/10 pl-6 text-[9px] text-white placeholder:text-orange-100/50 focus-visible:ring-orange-500/50"
                        />
                      </div>
                      <Select
                        value={sortBy}
                        onValueChange={(value) =>
                          setSortBy(value as "role" | "overall" | "potential")
                        }
                      >
                        <SelectTrigger className="h-6 border-white/20 bg-white/10 text-[9px] text-white focus:ring-orange-500/50 sm:w-24">
                          <SelectValue placeholder={t("teamPlanning.page.sortPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="role">{t("teamPlanning.page.sortRole")}</SelectItem>
                          <SelectItem value="overall">
                            {t("teamPlanning.page.sortOverall")}
                          </SelectItem>
                          <SelectItem value="potential">
                            {t("teamPlanning.page.sortPotential")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <TabsList className="mt-1 grid grid-cols-4 gap-0.5 rounded-full bg-slate-900/60 p-0.5">
                      <TabsTrigger
                        value="suggestions"
                        className={cn(
                          "rounded-full px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-orange-100 data-[state=active]:bg-orange-500 data-[state=active]:text-white",
                          !selectedSlotMeta && "opacity-50 pointer-events-none"
                        )}
                        disabled={!selectedSlotMeta}
                      >
                        {t("teamPlanning.page.tabs.suggestions")}
                      </TabsTrigger>
                      <TabsTrigger
                        value="starting"
                        className="rounded-full px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-orange-100 data-[state=active]:bg-orange-500 data-[state=active]:text-white"
                      >
                        {t("teamPlanning.page.tabs.starting", {
                          count: startingEleven.length,
                        })}
                      </TabsTrigger>
                      <TabsTrigger
                        value="bench"
                        className="rounded-full px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-orange-100 data-[state=active]:bg-orange-500 data-[state=active]:text-white"
                      >
                        {t("teamPlanning.page.tabs.bench", {
                          count: benchPlayers.length,
                        })}
                      </TabsTrigger>
                      <TabsTrigger
                        value="reserve"
                        className="rounded-full px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-orange-100 data-[state=active]:bg-orange-500 data-[state=active]:text-white"
                      >
                        {t("teamPlanning.page.tabs.reserve", {
                          count: reservePlayers.length,
                        })}
                      </TabsTrigger>
                    </TabsList>
                  </div>
                </div>

                <div
                  id="tp-right-scroll"
                  ref={rightPaneScrollRef}
                  className="flex-1 overflow-y-auto px-6 py-6"
                  onScroll={handleRightPaneScroll}
                >
                  <div className="mx-auto flex max-w-3xl flex-col gap-6">
                    <TabsContent value="suggestions" className="mt-0 space-y-4">
                      {!selectedSlotMeta ? (
                        <div className="flex h-full flex-col items-center justify-center space-y-2 text-center text-orange-100/50">
                          <p className="text-sm">{t("teamPlanning.page.suggestionsSelectSlot")}</p>
                        </div>
                      ) : recommendedPlayers.length === 0 ? (
                        <Card className="border-white/10 bg-white/5 text-center text-white shadow-lg backdrop-blur">
                          <CardContent className="p-8">
                            <div className="mb-4 text-4xl">⚽</div>
                            <h3 className="mb-2 text-base font-semibold">
                              {t("teamPlanning.page.noSuggestionsTitle")}
                            </h3>
                            <p className="text-sm text-emerald-100/70">
                              {t("teamPlanning.page.noSuggestionsDescription")}
                            </p>
                          </CardContent>
                        </Card>
                      ) : (
                        <>
                          <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <h3 className="font-semibold text-orange-100">
                              {t("teamPlanning.page.suggestionsTitle", {
                                label: selectedZoneDefinition?.label ?? "",
                              })}
                            </h3>
                            <span className="text-xs text-orange-100/60">
                              {t("teamPlanning.page.playersCount", {
                                count: recommendedPlayers.length,
                              })}
                            </span>
                          </div>
                          {recommendedPlayers.map((player) => {
                            const canAdjustContract =
                              getLegendIdFromPlayer(player) === null;
                            const metricValue = getPitchMetricValue(
                              player,
                              selectedMetric
                            );
                            return (
                              <PlayerCard
                                key={player.id}
                                player={player}
                                leagueId={teamLeagueIdRef.current}
                                ratingAnnotation={String(
                                  Math.round(metricValue)
                                )}
                                compact
                                defaultCollapsed
                                onSelect={() =>
                                  handleAlternativeSelection(player.id)
                                }
                                onShowDetails={() => {
                                  setFocusedPlayerId(player.id);
                                  setIsDetailOverlayOpen(true);
                                }}
                              />
                            );
                          })}
                        </>
                      )}
                    </TabsContent>

                    <TabsContent value="starting" className="mt-0 space-y-4">
                      {sortedPlayers.length === 0 ? (
                        <Card className="border-white/10 bg-white/5 text-center text-white shadow-lg backdrop-blur">
                          <CardContent className="p-8">
                            <div className="mb-4 text-4xl">⚽</div>
                            <h3 className="mb-2 text-base font-semibold">
                              {t("teamPlanning.page.emptyStartingTitle")}
                            </h3>
                            <p className="text-sm text-emerald-100/70">
                              {t("teamPlanning.page.emptyStartingDescription")}
                            </p>
                          </CardContent>
                        </Card>
                      ) : (
                        sortedPlayers.map((player) => {
                          const canAdjustContract =
                            getLegendIdFromPlayer(player) === null;
                          return (
                            <PlayerCard
                              key={player.id}
                              player={player}
                              leagueId={teamLeagueIdRef.current}
                              ratingAnnotation={getRatingAnnotation(player)}
                              compact
                              defaultCollapsed
                              draggable
                              onDragStart={(event) => {
                                setDraggedPlayerId(player.id);
                                event.dataTransfer.setData(
                                  "text/plain",
                                  player.id
                                );
                              }}
                              onDragEnd={() => setDraggedPlayerId(null)}
                              onMoveToBench={() =>
                                movePlayer(player.id, "bench")
                              }
                              onMoveToReserve={() =>
                                movePlayer(player.id, "reserve")
                              }
                              onListForTransfer={() =>
                                handleListForTransfer(player.id)
                              }
                              onRenamePlayer={() =>
                                setRenamePlayerId(player.id)
                              }
                              onFirePlayer={() => handleFirePlayer(player.id)}
                              onNegotiateSalary={
                                canAdjustContract
                                  ? () => openSalaryNegotiation(player.id)
                                  : undefined
                              }
                              onExtendContract={
                                canAdjustContract
                                  ? () => handleExtendContract(player.id)
                                  : undefined
                              }
                              onShowDetails={() => {
                                setFocusedPlayerId(player.id);
                                setIsDetailOverlayOpen(true);
                              }}
                            />
                          );
                        })
                      )}
                    </TabsContent>

                    <TabsContent value="bench" className="mt-0 space-y-4">
                      {sortedPlayers.length === 0 ? (
                        <Card className="border-white/10 bg-white/5 text-center text-white shadow-lg backdrop-blur">
                          <CardContent className="p-8">
                            <div className="mb-4 text-4xl">⚽</div>
                            <h3 className="mb-2 text-base font-semibold">
                              {t("teamPlanning.page.emptyBenchTitle")}
                            </h3>
                            <p className="text-sm text-emerald-100/70">
                              {t("teamPlanning.page.emptyBenchDescription")}
                            </p>
                          </CardContent>
                        </Card>
                      ) : (
                        sortedPlayers.map((player) => {
                          const canAdjustContract =
                            getLegendIdFromPlayer(player) === null;
                          return (
                            <PlayerCard
                              key={player.id}
                              player={player}
                              leagueId={teamLeagueIdRef.current}
                              ratingAnnotation={getRatingAnnotation(player)}
                              compact
                              defaultCollapsed
                              draggable
                              onDragStart={(event) => {
                                setDraggedPlayerId(player.id);
                                event.dataTransfer.setData(
                                  "text/plain",
                                  player.id
                                );
                              }}
                              onDragEnd={() => setDraggedPlayerId(null)}
                              onMoveToStarting={() =>
                                movePlayer(player.id, "starting")
                              }
                              moveToStartingLabel={getMoveToStartingLabel(
                                player
                              )}
                              onMoveToReserve={() =>
                                movePlayer(player.id, "reserve")
                              }
                              onListForTransfer={() =>
                                handleListForTransfer(player.id)
                              }
                              onRenamePlayer={() =>
                                setRenamePlayerId(player.id)
                              }
                              onFirePlayer={() => handleFirePlayer(player.id)}
                              onNegotiateSalary={
                                canAdjustContract
                                  ? () => openSalaryNegotiation(player.id)
                                  : undefined
                              }
                              onExtendContract={
                                canAdjustContract
                                  ? () => handleExtendContract(player.id)
                                  : undefined
                              }
                              onShowDetails={() => {
                                setFocusedPlayerId(player.id);
                                setIsDetailOverlayOpen(true);
                              }}
                            />
                          );
                        })
                      )}
                    </TabsContent>

                    <TabsContent value="reserve" className="mt-0 space-y-4">
                      {sortedPlayers.length === 0 ? (
                        <Card className="border-white/10 bg-white/5 text-center text-white shadow-lg backdrop-blur">
                          <CardContent className="p-8">
                            <div className="mb-4 text-4xl">⚽</div>
                            <h3 className="mb-2 text-base font-semibold">
                              {t("teamPlanning.page.emptyReserveTitle")}
                            </h3>
                            <p className="text-sm text-emerald-100/70">
                              {t("teamPlanning.page.emptyReserveDescription")}
                            </p>
                          </CardContent>
                        </Card>
                      ) : (
                        sortedPlayers.map((player) => {
                          const canAdjustContract =
                            getLegendIdFromPlayer(player) === null;
                          return (
                            <PlayerCard
                              key={player.id}
                              player={player}
                              leagueId={teamLeagueIdRef.current}
                              ratingAnnotation={getRatingAnnotation(player)}
                              compact
                              defaultCollapsed
                              draggable
                              onDragStart={(event) => {
                                setDraggedPlayerId(player.id);
                                event.dataTransfer.setData(
                                  "text/plain",
                                  player.id
                                );
                              }}
                              onDragEnd={() => setDraggedPlayerId(null)}
                              onMoveToStarting={() =>
                                movePlayer(player.id, "starting")
                              }
                              moveToStartingLabel={getMoveToStartingLabel(
                                player
                              )}
                              onMoveToBench={() =>
                                movePlayer(player.id, "bench")
                              }
                              onListForTransfer={() =>
                                handleListForTransfer(player.id)
                              }
                              onRenamePlayer={() =>
                                setRenamePlayerId(player.id)
                              }
                              onFirePlayer={() => handleFirePlayer(player.id)}
                              onNegotiateSalary={
                                canAdjustContract
                                  ? () => openSalaryNegotiation(player.id)
                                  : undefined
                              }
                              onExtendContract={
                                canAdjustContract
                                  ? () => handleExtendContract(player.id)
                                  : undefined
                              }
                              onShowDetails={() => {
                                setFocusedPlayerId(player.id);
                                setIsDetailOverlayOpen(true);
                              }}
                            />
                          );
                        })
                      )}
                    </TabsContent>
                  </div>
                </div>
              </Tabs>
            </div>
          </aside>
        </div>
      </div>

      <RenamePlayerDialog
        player={renamePlayer}
        renameInput={renameInput}
        balance={balance}
        diamondCost={PLAYER_RENAME_DIAMOND_COST}
        adCooldownHours={PLAYER_RENAME_AD_COOLDOWN_HOURS}
        isAdAvailable={isRenameAdAvailable}
        adAvailableAt={renameAdAvailableAt}
        isRenaming={isRenamingPlayer}
        onClose={() => setRenamePlayerId(null)}
        onChangeInput={setRenameInput}
        onRenameWithAd={() => handleRenamePlayer("ad")}
        onRenameWithPurchase={() => handleRenamePlayer("purchase")}
      />

      <SalaryNegotiationDialog
        player={negotiationPlayer}
        profile={salaryNegotiationProfile}
        offer={negotiationOffer}
        confidence={negotiationConfidence}
        minOffer={salaryNegotiationProfile?.floor ?? MIN_SALARY_OFFER}
        isSubmitting={isNegotiatingSalary}
        attempt={negotiationAttempts}
        maxAttempts={MAX_NEGOTIATION_ATTEMPTS}
        counterOffer={playerCounterOffer}
        isFinalCounter={isFinalCounterStage}
        isLocked={isFinalCounterStage}
        onOfferChange={setNegotiationOffer}
        onClose={() => setNegotiationPlayerId(null)}
        onSubmit={handleConfirmSalaryNegotiation}
        onAcceptCounter={handleAcceptCounterOffer}
        onRejectCounter={handleRejectCounterOffer}
      />

      <ContractDecisionDialog
        player={activeContractPlayer}
        teamLeagueId={teamLeagueIdRef.current}
        isProcessing={isProcessingContract}
        onRelease={() =>
          activeContractPlayer && handleReleaseContract(activeContractPlayer.id)
        }
        onExtend={() =>
          activeContractPlayer && handleExtendContract(activeContractPlayer.id)
        }
      />

      <PlayerDetailOverlay
        isOpen={isDetailOverlayOpen}
        onClose={() => setIsDetailOverlayOpen(false)}
        player={selectedPlayer}
        onMoveToStarting={(id) => {
          movePlayer(id, "starting");
          setIsDetailOverlayOpen(false);
        }}
        moveToStartingLabel={
          selectedPlayer ? getMoveToStartingLabel(selectedPlayer) : undefined
        }
        onMoveToBench={(id) => {
          movePlayer(id, "bench");
          setIsDetailOverlayOpen(false);
        }}
        onMoveToReserve={(id) => {
          movePlayer(id, "reserve");
          setIsDetailOverlayOpen(false);
        }}
        onRename={(id) => {
          setRenamePlayerId(id);
          setIsDetailOverlayOpen(false);
        }}
        onUseKits={handleOpenKitUsage}
        onNegotiateSalary={(id) => {
          openSalaryNegotiation(id);
          setIsDetailOverlayOpen(false);
        }}
        onSellPlayer={(id) => {
          handleListForTransfer(id);
          setIsDetailOverlayOpen(false);
        }}
        onExtendContract={(id) => {
          handleExtendContract(id);
          setIsDetailOverlayOpen(false);
        }}
        onFirePlayer={(id) => {
          handleFirePlayer(id);
          setIsDetailOverlayOpen(false);
        }}
        onReleasePlayer={(id) => {
          handleReleaseContract(id);
          setIsDetailOverlayOpen(false);
        }}
      />

      <LineupReadinessDialog
        open={isLineupReadinessOpen}
        issues={lineupReadinessIssues}
        thresholdPercent={Math.round(LINEUP_VITAL_THRESHOLD * 100)}
        onOpenChange={setIsLineupReadinessOpen}
        onUseKits={handleOpenLineupIssueKitUsage}
        onBenchPlayer={handleBenchLineupIssuePlayer}
      />

      <KitUsageDialog
        open={isKitUsageOpen}
        kitType={null}
        playerId={kitUsagePlayerId}
        onApplied={handleKitApplied}
        surface="team_planning"
        onOpenChange={handleKitUsageOpenChange}
      />
    </>
  );
}

export default function TeamPlanning() {
  return (
    <TeamPlanningProvider>
      <TeamPlanningContent />
    </TeamPlanningProvider>
  );
}

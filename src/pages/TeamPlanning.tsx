import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlayerCard } from '@/components/ui/player-card';
import { PerformanceGauge, clampPerformanceGauge } from '@/components/ui/performance-gauge';
import type { Player } from '@/types';
import { getTeam, saveTeamPlayers, createInitialTeam } from '@/services/team';
import {
  buildSalaryNegotiationProfile,
  clampNumber,
  formatSalary,
  type SalaryNegotiationProfile,
} from '@/lib/contractNegotiation';
import { completeLegendRental, getLegendIdFromPlayer } from '@/services/legends';
import { auth } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { Search, Save, Eye, X, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formations } from '@/lib/formations';
import {
  normalizeRatingTo100,
  calculatePowerIndex,
  formatRatingLabel,
} from '@/lib/player';
import { cn } from '@/lib/utils';
import { BackButton } from '@/components/ui/back-button';
import Pitch, { type PitchSlot } from '@/features/team-planning/Pitch';
import {
  TeamPlanningProvider,
  useTeamPlanningStore,
  type PlayerPosition as StorePlayerPosition,
  type MetricKey,
} from '@/features/team-planning/useTeamPlanningStore';
import { ContractDecisionDialog } from '@/features/team-planning/dialogs/ContractDecisionDialog';
import { RenamePlayerDialog } from '@/features/team-planning/dialogs/RenamePlayerDialog';
import { SalaryNegotiationDialog } from '@/features/team-planning/dialogs/SalaryNegotiationDialog';
import { PlayerDetailOverlay } from '@/features/team-planning/components/PlayerDetailOverlay';
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
  getPlayerMotivation,
  getPlayerPower,
  getPositionLabel,
  getRenameAdAvailability,
  HOURS_IN_MS,
  isContractExpired,
  isRenameAdReady,
  metricOptions,
  MIN_SALARY_OFFER,
  normalizePlayers,
  PLAYER_RENAME_AD_COOLDOWN_HOURS,
  PLAYER_RENAME_DIAMOND_COST,
  promotePlayerToStartingRoster,
  sanitizeCustomFormationState,
  squadRoleWeight,
  deriveFormationShape,
  PromoteToStartingResult,
  negotiationConfidenceFromOffer,
} from '@/features/team-planning/teamPlanningUtils';
import { AlternativePlayerBubble } from '@/features/team-planning/components/AlternativePlayerBubble';
import {
  getZoneDefinition,
  recommendPlayers,
  resolveZoneId,
  positionAffinity,
  type ZoneId,
} from '@/features/team-planning/slotZones';

import './team-planning.css';
import './TeamPlanningSizing.css';

type SelectedSlotMeta = {
  slotIndex: number;
  zoneId: ZoneId;
  x: number;
  y: number;
  position: Player['position'];
};

function TeamPlanningContent() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { balance, spend } = useDiamonds();
  const [players, setPlayers] = useState<Player[]>([]);
  const playerBaselineRef = useRef<Record<string, PlayerBaseline>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('starting');
  const [selectedFormation, setSelectedFormation] = useState(formations[0].name);
  const [customFormations, setCustomFormations] = useState<CustomFormationState>({});
  const [bootstrappedUserId, setBootstrappedUserId] = useState<string | null>(null);

  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'role' | 'overall' | 'potential'>('role');
  const [focusedPlayerId, setFocusedPlayerId] = useState<string | null>(null);
  const [savedFormationShape, setSavedFormationShape] = useState<string | null>(null);
  const [renamePlayerId, setRenamePlayerId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [isRenamingPlayer, setIsRenamingPlayer] = useState(false);
  const [pendingContractIds, setPendingContractIds] = useState<string[]>([]);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [isProcessingContract, setIsProcessingContract] = useState(false);
  const [negotiationPlayerId, setNegotiationPlayerId] = useState<string | null>(null);
  const [negotiationOffer, setNegotiationOffer] = useState(0);
  const [isNegotiatingSalary, setIsNegotiatingSalary] = useState(false);
  const [negotiationAttempts, setNegotiationAttempts] = useState(0);
  const [playerCounterOffer, setPlayerCounterOffer] = useState<number | null>(null);
  const [isFinalCounterStage, setIsFinalCounterStage] = useState(false);
  const MAX_NEGOTIATION_ATTEMPTS = 3;

  const pitchRef = useRef<HTMLDivElement | null>(null);
  const dropHandledRef = useRef(false);
  const handledContractsRef = useRef<Set<string>>(new Set());
  const rightPaneScrollRef = useRef<HTMLDivElement | null>(null);
  const [isRightHeaderCollapsed, setIsRightHeaderCollapsed] = useState(false);
  const teamLeagueIdRef = useRef<string | null>(null);
  const [selectedSlotMeta, setSelectedSlotMeta] = useState<SelectedSlotMeta | null>(null);
  const [isListCollapsed, setIsListCollapsed] = useState(false);
  const [isDetailOverlayOpen, setIsDetailOverlayOpen] = useState(false);
  /* isListCollapsed already declared above */

  const {
    selectedMetric,
    setSelectedMetric,
    setPlayerPositions,
    updateFormationFromPositions,
    registerFormationUpdater,
  } = useTeamPlanningStore();

  useEffect(() => {
    players.forEach(player => {
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
      players.map(player =>
        buildDisplayPlayer(player, playerBaselineRef.current[player.id]),
      ),
    [players],
  );


  const applyFormationPositions = useCallback(
    (positions: Record<string, StorePlayerPosition>) => {
      setCustomFormations(prev => {
        const entries = Object.entries(positions);
        if (entries.length === 0) {
          if (!(selectedFormation in prev)) {
            return prev;
          }
          const { [selectedFormation]: _removed, ...rest } = prev;
          return rest;
        }

        const layout = entries.reduce<Record<string, FormationPlayerPosition>>(
          (acc, [playerId, value]) => {
            acc[playerId] = {
              x: clampPercentageValue(value.x),
              y: clampPercentageValue(value.y),
              position: value.position,
            };
            return acc;
          },
          {},
        );

        if (
          prev[selectedFormation] &&
          Object.entries(prev[selectedFormation]).length === entries.length &&
          entries.every(([playerId, value]) => {
            const current = prev[selectedFormation]?.[playerId];
            return (
              current &&
              current.x === clampPercentageValue(value.x) &&
              current.y === clampPercentageValue(value.y) &&
              current.position === value.position
            );
          })
        ) {
          return prev;
        }

        return {
          ...prev,
          [selectedFormation]: layout,
        };
      });
    },
    [selectedFormation],
  );

  useEffect(() => {
    registerFormationUpdater(applyFormationPositions);
  }, [registerFormationUpdater, applyFormationPositions]);

  const handleRightPaneScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const collapsed = event.currentTarget.scrollTop >= 24;
      setIsRightHeaderCollapsed(previous =>
        previous === collapsed ? previous : collapsed,
      );
    },
    [],
  );

  useEffect(() => {
    const container = rightPaneScrollRef.current;
    if (!container) {
      return;
    }
    setIsRightHeaderCollapsed(container.scrollTop >= 24);
  }, []);


  const filteredPlayers = displayPlayers.filter(
    player =>
      player.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      player.squadRole === activeTab,
  );

  const getRatingAnnotation = useCallback(
    (player: DisplayPlayer) =>
      player.originalOverall > player.assignedOverall
        ? `Orj: ${formatRatingLabel(player.originalOverall)}`
        : undefined,
    [],
  );

  const POSITION_ORDER: Player['position'][] = [
    'GK',
    'LB',
    'CB',
    'RB',
    'LM',
    'CM',
    'RM',
    'CAM',
    'LW',
    'RW',
    'ST',
  ];

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    switch (sortBy) {
      case 'overall':
        return b.overall - a.overall;
      case 'potential':
        return b.potential - a.potential;
      default:
        return (
          POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
        );
    }
  });

  const renamePlayer = useMemo(
    () => displayPlayers.find(player => player.id === renamePlayerId) ?? null,
    [displayPlayers, renamePlayerId],
  );

  const activeContractPlayer = useMemo(
    () => displayPlayers.find(player => player.id === activeContractId) ?? null,
    [displayPlayers, activeContractId],
  );

  const negotiationPlayer = useMemo(
    () => displayPlayers.find(player => player.id === negotiationPlayerId) ?? null,
    [displayPlayers, negotiationPlayerId],
  );

  const salaryNegotiationProfile = useMemo(
    () =>
      negotiationPlayer
        ? buildSalaryNegotiationProfile(negotiationPlayer, { gaugeFallback: DEFAULT_GAUGE_VALUE })
        : null,
    [negotiationPlayer],
  );

  useEffect(() => {
    if (!salaryNegotiationProfile) {
      setNegotiationOffer(0);
      return;
    }
    const floor = salaryNegotiationProfile.floor;
    const ceiling = salaryNegotiationProfile.ceiling;
    setNegotiationOffer(prev => {
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
        negotiationPlayer,
      ),
    [negotiationOffer, salaryNegotiationProfile, negotiationPlayer],
  );

  const resetNegotiationState = useCallback(() => {
    setNegotiationAttempts(0);
    setPlayerCounterOffer(null);
    setIsFinalCounterStage(false);
    setNegotiationOffer(0);
  }, []);

  const buildPlayerCounterOffer = useCallback(
    (offer: number, profile: SalaryNegotiationProfile, attemptNumber: number) => {
      const anchor = Math.max(profile.demand, profile.baseSalary);
      const comfortFloor = Math.max(profile.floor, Math.round(anchor * 0.55));
      const weight = clampNumber(0.35 + attemptNumber * 0.15, 0.35, 0.9);
      const blended = offer * weight + anchor * (1 - weight);
      const counter = clampNumber(
        Math.round(blended),
        Math.max(offer, comfortFloor),
        profile.ceiling,
      );
      return counter;
    },
    [],
  );

  useEffect(() => {
    if (!negotiationPlayer) {
      resetNegotiationState();
    }
  }, [negotiationPlayer, resetNegotiationState]);

  const isRenameAdAvailable = renamePlayer ? isRenameAdReady(renamePlayer) : true;
  const renameAdAvailableAt = renamePlayer
    ? getRenameAdAvailability(renamePlayer)
    : null;

  const [manualSlotPositions, setManualSlotPositions] = useState<Record<string, FormationPlayerPosition>>({});
  const syncManualSlotsForFormation = useCallback(
    (formationName: string) => {
      const layout = customFormations[formationName];
      if (!layout) {
        setManualSlotPositions(prev => {
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
          },
        ]),
      ) as Record<string, FormationPlayerPosition>;
      setManualSlotPositions(prev => {
        if (
          Object.keys(prev).length === Object.keys(normalized).length &&
          Object.entries(normalized).every(([playerId, nextValue]) => {
            const current = prev[playerId];
            return (
              current &&
              current.x === nextValue.x &&
              current.y === nextValue.y &&
              current.position === nextValue.position
            );
          })
        ) {
          return prev;
        }
        return normalized;
      });
    },
    [customFormations],
  );

  const removePlayerFromCustomFormations = (playerId: string) => {
    setCustomFormations(prev => {
      let changed = false;
      const nextEntries: [string, Record<string, FormationPlayerPosition>][] = [];

      Object.entries(prev).forEach(([formationKey, layout]) => {
        if (!layout || typeof layout !== 'object') {
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
    setManualSlotPositions(prev => {
      if (!(playerId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[playerId];
      return next;
    });
  };

  const updatePlayerManualPosition = useCallback(
    (formationName: string, playerId: string, data: FormationPlayerPosition) => {
      setCustomFormations(prev => {
        const currentFormation = prev[formationName] ?? {};
        const normalized: FormationPlayerPosition = {
          x: clampPercentageValue(data.x),
          y: clampPercentageValue(data.y),
          position: data.position,
        };

        const existing = currentFormation[playerId];
        if (
          existing &&
          existing.x === normalized.x &&
          existing.y === normalized.y &&
          existing.position === normalized.position
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
    [],
  );

  const finalizeContractDecision = (playerId: string) => {
    handledContractsRef.current.add(playerId);
    setPendingContractIds(prev => prev.filter(id => id !== playerId));
    setActiveContractId(prev => (prev === playerId ? null : prev));
  };

  const movePlayer = (playerId: string, newRole: Player['squadRole']) => {
    let errorMessage: string | null = null;
    let changed = false;
    let swappedPlayerId: string | null = null;

    setPlayers(prev => {
      const playerIndex = prev.findIndex(player => player.id === playerId);
      if (playerIndex === -1) {
        errorMessage = 'Oyuncu bulunamadı.';
        return prev;
      }

      const player = prev[playerIndex];
      if (newRole === 'starting') {
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
      toast.error('işlem tamamlanamadı', { description: errorMessage });
    } else if (changed) {
      if (newRole !== 'starting') {
        removePlayerFromCustomFormations(playerId);
      } else if (swappedPlayerId) {
        removePlayerFromCustomFormations(swappedPlayerId);
      }
      toast.success('Oyuncu başarıyla taşındı');
    }
  };

  const handleRenamePlayer = async (method: 'ad' | 'purchase') => {
    if (!user || !renamePlayer) {
      return;
    }

    const userId = user.id;
    const trimmed = renameInput.trim();
    if (trimmed.length < 2) {
      toast.error('İsim en az 2 karakter olmalı');
      return;
    }

    if (trimmed === renamePlayer.name) {
      toast.info('Oyuncu adı değişmedi');
      return;
    }

    if (method === 'ad' && !isRenameAdAvailable) {
      const availableAt = getRenameAdAvailability(renamePlayer);
      const message = availableAt
        ? `Reklam ${availableAt.toLocaleString('tr-TR')} sonrasında tekrar izlenebilir.`
        : 'Reklam hakkı şu anda kullanılamıyor.';
      toast.error(message);
      return;
    }

    if (method === 'purchase' && balance < PLAYER_RENAME_DIAMOND_COST) {
      toast.error('Yetersiz elmas bakiyesi');
      return;
    }

    const previousPlayers = players.map(player => ({ ...player }));
    let diamondsSpent = false;

    setIsRenamingPlayer(true);

    try {
      if (method === 'purchase') {
        await spend(PLAYER_RENAME_DIAMOND_COST);
        diamondsSpent = true;
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const now = new Date();
      const adCooldown = new Date(
        now.getTime() + PLAYER_RENAME_AD_COOLDOWN_HOURS * HOURS_IN_MS,
      );

      const updatedPlayers = normalizePlayers(
        players.map(player => {
          if (player.id !== renamePlayer.id) {
            return player;
          }
          const currentRename = player.rename ?? { adAvailableAt: new Date(0).toISOString() };
          return {
            ...player,
            name: trimmed,
            rename: {
              ...currentRename,
              lastUpdatedAt: now.toISOString(),
              lastMethod: method === 'purchase' ? 'purchase' : 'ad',
              adAvailableAt:
                method === 'ad'
                  ? adCooldown.toISOString()
                  : currentRename.adAvailableAt ?? now.toISOString(),
            },
          };
        }),
      );

      setPlayers(updatedPlayers);
      await saveTeamPlayers(userId, updatedPlayers);
      toast.success('Oyuncu adı güncellendi');
      setRenamePlayerId(null);
    } catch (error) {
      console.error('[TeamPlanning] player rename failed', error);
      toast.error('Oyuncu adı güncellenemedi');
      setPlayers(previousPlayers);
      if (method === 'purchase' && diamondsSpent) {
        toast.error('Elmas harcaması yapıldı, lütfen destek ekibiyle iletişime geçin.');
      }
    } finally {
      setIsRenamingPlayer(false);
    }
  };

  const openSalaryNegotiation = (playerId: string) => {
    const target = displayPlayers.find(player => player.id === playerId);
    if (!target) {
      return;
    }
    if (getLegendIdFromPlayer(target) !== null) {
      toast.error('Nostalji oyuncularıyla maaş pazarlığı yapılamaz.');
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
      salaryNegotiationProfile.ceiling,
    );
    const userId = user.id;
    const previousPlayers = players.map(player => ({ ...player }));
    const now = new Date();
    const currentExpiry = getContractExpiration(negotiationPlayer);
    const baseDate = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
    const newExpiry = addMonths(baseDate, CONTRACT_EXTENSION_MONTHS);

    const confidence = negotiationConfidenceFromOffer(
      clampedOffer,
      salaryNegotiationProfile,
      negotiationPlayer,
    );

    const updatedPlayers = players.map(player => {
      if (player.id !== negotiationPlayer.id) {
        return player;
      }
      const currentContract = player.contract ?? {
        expiresAt: newExpiry.toISOString(),
        status: 'active' as const,
        salary: clampedOffer,
        extensions: 0,
      };
      return {
        ...player,
        contract: {
          ...currentContract,
          salary: clampedOffer,
          expiresAt: newExpiry.toISOString(),
          status: 'active' as const,
          extensions: (currentContract.extensions ?? 0) + 1,
        },
        motivation: clampPerformanceGauge(
          player.motivation + Math.min(0.08, confidence * 0.2),
          DEFAULT_GAUGE_VALUE,
        ),
      };
    });

    const normalized = normalizePlayers(updatedPlayers);
    setPlayers(normalized);
    setIsNegotiatingSalary(true);
    try {
      await saveTeamPlayers(userId, normalized);
      toast.success(
        `${negotiationPlayer.name} maaşı ${formatSalary(clampedOffer)} oldu ve sözleşmesi ${CONTRACT_EXTENSION_MONTHS} ay uzatıldı.`,
      );
      finalizeContractDecision(negotiationPlayer.id);
      setNegotiationPlayerId(null);
      resetNegotiationState();
    } catch (error) {
      console.error('[TeamPlanning] salary negotiation failed', error);
      toast.error('Maaş pazarlığı tamamlanamadı.');
      toast.error('Maaş pazarlığı tamamlanamadı.');
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
      salaryNegotiationProfile.ceiling,
    );

    const attemptNumber = negotiationAttempts + 1;
    const acceptanceChance = negotiationConfidenceFromOffer(
      clampedOffer,
      salaryNegotiationProfile,
      negotiationPlayer,
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
      attemptNumber,
    );
    const remainingAttempts = Math.max(MAX_NEGOTIATION_ATTEMPTS - attemptNumber, 0);
    const isFinal = attemptNumber >= MAX_NEGOTIATION_ATTEMPTS;

    setNegotiationAttempts(attemptNumber);
    setPlayerCounterOffer(counter);
    setIsFinalCounterStage(isFinal);
    setNegotiationOffer(counter);

    const counterMessage = isFinal
      ? `Kabul edilmedi. Oyuncunun son teklifi: ${formatSalary(counter)}.`
      : `Kabul edilmedi. Oyuncunun karşı teklifi: ${formatSalary(counter)}. Kalan hak: ${remainingAttempts}`;
    toast.info(counterMessage);
  };

  const handleAcceptCounterOffer = async () => {
    if (playerCounterOffer === null) {
      return;
    }
    await completeSalaryNegotiation(playerCounterOffer);
  };

  const handleRejectCounterOffer = () => {
    toast.info('Pazarlık sonuçsuz kaldı, sözleşme değişmedi.');
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
    const target = players.find(player => player.id === playerId);
    if (!target) {
      return;
    }

    const isLegendRental = getLegendIdFromPlayer(target) !== null;

    if (isLegendRental) {
      setIsProcessingContract(true);
      const previousPlayers = players.map(player => ({ ...player }));
      const updatedPlayers = players.filter(player => player.id !== playerId);

      setPlayers(updatedPlayers);
      try {
        await completeLegendRental(userId, playerId, { players: previousPlayers });
        toast.info(`${target.name} ile yapılan kiralama sona erdi.`);
        finalizeContractDecision(playerId);
      } catch (error) {
        console.error('[TeamPlanning] legend rental release failed', error);
        toast.error('Oyuncu kadrodan kaldırılamadı');
        setPlayers(previousPlayers);
      } finally {
        setIsProcessingContract(false);
      }
      return;
    }

    setIsProcessingContract(true);
    const previousPlayers = players.map(player => ({ ...player }));
    const updatedPlayers = players.map(player => {
      if (player.id !== playerId) {
        return player;
      }
      const currentContract = player.contract ?? {
        expiresAt: new Date().toISOString(),
        status: 'expired',
        salary: 0,
        extensions: 0,
      };
      return {
        ...player,
        squadRole: player.squadRole === 'starting' ? 'reserve' : player.squadRole,
        contract: {
          ...currentContract,
          status: 'released' as const,
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
      toast.info(`${target.name} serbest bırakıldı ve transfer listesine eklendi`);
      finalizeContractDecision(playerId);
    } catch (error) {
      console.error('[TeamPlanning] release contract failed', error);
      toast.error('Oyuncu serbest bırakılamadı');
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
    const target = players.find(player => player.id === playerId);
    if (!target) {
      return;
    }

    const previousPlayers = players.map(player => ({ ...player }));
    const updatedPlayers = players.filter(player => player.id !== playerId);

    setPlayers(updatedPlayers);
    try {
      await saveTeamPlayers(user.id, updatedPlayers);
      removePlayerFromCustomFormations(playerId);
      toast.success(`${target.name} takımdan gönderildi`);
      finalizeContractDecision(playerId);
    } catch (error) {
      console.error('[TeamPlanning] fire player failed', error);
      toast.error('Oyuncu kovulamadı');
      setPlayers(previousPlayers);
    }
  };

  const getPitchCoordinates = useCallback((clientX: number, clientY: number): FormationPlayerPosition | null => {
    const field = pitchRef.current;
    if (!field) {
      return null;
    }
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
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
      position: 'CM',
    };
  }, []);

  const applyManualPosition = useCallback(
    (playerId: string, data: FormationPlayerPosition, formationName = selectedFormation) => {
      const normalized: FormationPlayerPosition = {
        x: clampPercentageValue(data.x),
        y: clampPercentageValue(data.y),
        position: data.position,
      };
      updatePlayerManualPosition(formationName, playerId, normalized);
      setManualSlotPositions(prev => ({
        ...prev,
        [playerId]: normalized,
      }));
    },
    [selectedFormation, updatePlayerManualPosition],
  );

  const handlePitchMarkerDragStart = useCallback(
    (player: Player, event: React.DragEvent<HTMLDivElement>) => {
      setDraggedPlayerId(player.id);
      event.dataTransfer.setData('text/plain', player.id);
      event.dataTransfer.effectAllowed = 'move';

      // Auto-collapse list on drag start for focus mode
      setIsListCollapsed(true);
    },
    [],
  );

  // Removed duplicate getPitchMetricValue

  const renderPitchTooltip = useCallback(
    (player: DisplayPlayer) => (
      <div className="space-y-2">
        <div className="text-xs font-semibold">{player.name}</div>
        <PerformanceGauge
          label="Güç"
          value={normalizeRatingTo100(calculatePowerIndex(player))}
          variant="dark"
        />
        <PerformanceGauge
          label="Kondisyon"
          value={clampPercentageValue((player.condition ?? 0) * 100)}
          variant="dark"
        />
        <PerformanceGauge
          label="Motivasyon"
          value={clampPercentageValue((player.motivation ?? 0) * 100)}
          variant="dark"
        />
        {player.originalOverall > player.overall ? (
          <div className="text-[11px] text-muted-foreground">
            Orjinal: {formatRatingLabel(player.originalOverall)} / Şuanki:{' '}
            {formatRatingLabel(player.overall)}
          </div>
        ) : null}
      </div>
    ),
    [],
  );

  const handleListForTransfer = (playerId: string) => {
    navigate('/transfer-market', { state: { listPlayerId: playerId } });
  };

  const handleReleasePlayer = (playerId: string) => {
    let removedName: string | null = null;
    removePlayerFromCustomFormations(playerId);
    setPlayers(prev => {
      const player = prev.find(p => p.id === playerId);
      if (!player) {
        return prev;
      }
      removedName = player.name;
      return prev.filter(p => p.id !== playerId);
    });
    if (removedName) {
      setFocusedPlayerId(current => (current === playerId ? null : current));
      toast.success(`${removedName} serbest brakld`, {
        description: 'Değişlikleri kaydetmeyi unutmayn.',
      });
    }
  };

  const handleSave = async () => {
    if (!user) return;
    try {
      const collectIds = (role: Player['squadRole']) =>
        players
          .filter(p => p.squadRole === role && p.id)
          .map(p => String(p.id));

      const unique = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

      const starters = unique(collectIds('starting'));
      if (starters.length !== 11) {
        toast.error('Kadro tamamlanmadı', {
          description: 'Kaydetmeden önce 11 oyuncuyu ilk 11 olarak belirleyin.',
        });
        return;
      }

      const bench = unique(collectIds('bench')).filter(id => !starters.includes(id));
      const reserves = unique(collectIds('reserve')).filter(id => !starters.includes(id) && !bench.includes(id));

      const startersSet = new Set(starters);
      const customForSave = Object.fromEntries(
        Object.entries(customFormations).flatMap(([formationKey, layout]) => {
          if (!layout || typeof layout !== 'object') {
            return [];
          }
          const filteredEntries = Object.entries(layout).filter(([playerId]) =>
            startersSet.has(playerId),
          );
          if (filteredEntries.length === 0) {
            return [];
          }
          const sanitizedLayout = Object.fromEntries(
            filteredEntries.map(([playerId, value]) => [
              playerId,
              {
                x: clampPercentageValue(value.x),
                y: clampPercentageValue(value.y),
                position: value.position,
              },
            ]),
          );
          return [[formationKey, sanitizedLayout]];
        }),
      ) as CustomFormationState;

      const fallbackShape =
        (derivedFormationShape && derivedFormationShape.trim().length > 0
          ? derivedFormationShape
          : savedFormationShape && savedFormationShape.trim().length > 0
            ? savedFormationShape
            : selectedFormation) ?? selectedFormation;
      const shapeForSave = fallbackShape.trim();

      // Persist full roster and snapshot locally for Firestore
      await saveTeamPlayers(user.id, players, {
        formation: selectedFormation,
        shape: shapeForSave,
        squads: {
          starters,
          bench,
          reserves,
        },
        customFormations:
          Object.keys(customForSave).length > 0 ? customForSave : undefined,
      });

      setSavedFormationShape(shapeForSave);
      toast.success('Takım planı kaydedildi!');
    } catch (error) {
      console.error('[TeamPlanning] saveTeamPlayers failed', error);
      const description =
        error && typeof error === 'object' && 'details' in error && typeof (error as { details?: unknown }).details === 'string'
          ? String((error as { details?: unknown }).details)
          : error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
            ? String((error as { message?: unknown }).message)
            : 'Kadro kaydı başarısız. Lütfen tekrar deneyin.';
      toast.error('Sunucu hatası', { description });
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
      const preferredTeamName = (user.teamName?.includes('@') ? user.teamName.split('@')[0] : user.teamName) || 'Takimim';
      const managerName = user.username || preferredTeamName;

      let team: Awaited<ReturnType<typeof getTeam>> | null = null;
      try {
        team = await getTeam(user.id);
      } catch (error) {
        console.error('[TeamPlanning] getTeam failed', error);
        toast.error('Takim bilgisi yuklenemedi. Lutfen tekrar deneyin.');
        return;
      }

      if (!team) {
        try {
          await auth.currentUser?.getIdToken(true).catch((err) => {
            console.warn('[TeamPlanning] token refresh before team create failed', err);
          });
          team = await createInitialTeam(user.id, preferredTeamName, managerName, {
            authUser: auth.currentUser,
          });
        } catch (error) {
          console.error('[TeamPlanning] createInitialTeam failed', error);
          toast.error('Takim olusturulamadi. Lutfen tekrar deneyin.');
          return;
        }
      }

      if (!isMounted) {
        return;
      }

      teamLeagueIdRef.current =
        typeof (team as { leagueId?: string | null } | null)?.leagueId === 'string'
          ? (team as { leagueId?: string | null }).leagueId
          : null;

      const normalized = normalizePlayers(team.players);
      setPlayers(normalized);

      const remoteFormation =
        team.plan?.formation || team.lineup?.formation || formations[0].name;
      setSelectedFormation(remoteFormation);

      const remoteCustomFormations = sanitizeCustomFormationState(
        team.plan?.customFormations || team.lineup?.customFormations || {},
      );
      setCustomFormations(remoteCustomFormations);

      const rawPlanShape =
        typeof team.plan?.shape === 'string' ? team.plan.shape.trim() : '';
      const rawLineupShape =
        typeof team.lineup?.shape === 'string' ? team.lineup.shape.trim() : '';
      const normalizedShape =
        rawPlanShape && rawPlanShape.toLowerCase() !== 'auto'
          ? rawPlanShape
          : rawLineupShape && rawLineupShape.toLowerCase() !== 'auto'
            ? rawLineupShape
            : '';
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
    if (focusedPlayerId && players.some(p => p.id === focusedPlayerId)) {
      return;
    }
    const fallback = players.find(p => p.squadRole === 'starting') ?? players[0];
    if (fallback && fallback.id !== focusedPlayerId) {
      setFocusedPlayerId(fallback.id);
    }
  }, [players, focusedPlayerId]);

  useEffect(() => {
    if (renamePlayer) {
      setRenameInput(renamePlayer.name);
    } else {
      setRenameInput('');
    }
  }, [renamePlayer]);

  useEffect(() => {
    const expiredIds = new Set(
      players.filter(player => isContractExpired(player)).map(player => player.id),
    );

    handledContractsRef.current.forEach(id => {
      if (!expiredIds.has(id)) {
        handledContractsRef.current.delete(id);
      }
    });

    setPendingContractIds(prev => {
      const existing = new Set(prev);
      const next = [...prev];
      players.forEach(player => {
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
    setActiveContractId(prev => (prev && pendingContractIds.includes(prev) ? prev : pendingContractIds[0]));
  }, [pendingContractIds]);

  useEffect(() => {
    if (players.length === 0) {
      return;
    }

    const startingIds = new Set(
      players.filter(player => player.squadRole === 'starting').map(player => player.id),
    );

    setCustomFormations(prev => {
      let changed = false;
      const next: CustomFormationState = {};

      Object.entries(prev).forEach(([formationKey, layout]) => {
        const filteredEntries = Object.entries(layout).filter(([playerId]) =>
          startingIds.has(playerId),
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

    setManualSlotPositions(prev => {
      const entries = Object.entries(prev).filter(([playerId]) => startingIds.has(playerId));
      if (entries.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(entries);
    });
  }, [players]);

  const startingEleven = displayPlayers.filter(p => p.squadRole === 'starting');
  const benchPlayers = displayPlayers.filter(p => p.squadRole === 'bench');
  const reservePlayers = displayPlayers.filter(p => p.squadRole === 'reserve');

  const currentFormation =
    formations.find(f => f.name === selectedFormation) ?? formations[0];
  const manualFormation = useMemo(
    () => customFormations[selectedFormation] ?? {},
    [customFormations, selectedFormation],
  );

  useEffect(() => {
    syncManualSlotsForFormation(selectedFormation);
  }, [selectedFormation, syncManualSlotsForFormation]);

  const formationPositions: PitchSlot[] = useMemo(() => {
    const starters = displayPlayers.filter(p => p.squadRole === 'starting');
    const slots = currentFormation.positions;

    if (starters.length === 0) {
      return slots.map((slot, idx) => ({ ...slot, player: null, slotIndex: idx }));
    }

    const startersById = new Map(starters.map(player => [player.id, player] as const));
    const remainingPlayerIds = new Set(starters.map(player => player.id));
    const slotAssignments = new Map<
      number,
      { player: Player; manual: FormationPlayerPosition | null }
    >();

    Object.entries(manualFormation).forEach(([playerId, manual]) => {
      const player = startersById.get(playerId);
      if (!player) {
        return;
      }

      const targetIndex = slots.findIndex((slot, idx) => {
        if (slotAssignments.has(idx)) {
          return false;
        }
        const canonicalSlot = canonicalPosition(slot.position);
        const manualPosition = manual?.position ?? player.position;
        return canonicalPosition(manualPosition) === canonicalSlot;
      });

      if (targetIndex === -1) {
        return;
      }

      slotAssignments.set(targetIndex, { player, manual });
      remainingPlayerIds.delete(playerId);
    });

    slots.forEach((slot, idx) => {
      if (slotAssignments.has(idx)) {
        return;
      }

      const canonicalSlot = canonicalPosition(slot.position);
      const matchingEntry = Array.from(remainingPlayerIds).find(playerId => {
        const candidate = startersById.get(playerId);
        if (!candidate) return false;
        const playerPosition = canonicalPosition(candidate.position);
        if (playerPosition === canonicalSlot) {
          return true;
        }
        return (candidate.roles ?? []).some(role => canonicalPosition(role) === canonicalSlot);
      });

      if (!matchingEntry) {
        return;
      }

      const player = startersById.get(matchingEntry);
      if (!player) {
        return;
      }

      slotAssignments.set(idx, { player, manual: null });
      remainingPlayerIds.delete(matchingEntry);
    });

    slots.forEach((slot, idx) => {
      if (slotAssignments.has(idx) || remainingPlayerIds.size === 0) {
        return;
      }

      const iterator = remainingPlayerIds.values().next();
      if (iterator.done) {
        return;
      }

      const player = startersById.get(iterator.value);
      remainingPlayerIds.delete(iterator.value);
      if (!player) {
        return;
      }

      slotAssignments.set(idx, { player, manual: null });
    });

    return slots.map((slot, idx) => {
      const assigned = slotAssignments.get(idx);
      if (!assigned) {
        return { ...slot, player: null, slotIndex: idx };
      }

      const { player, manual } = assigned;
      const manualOverride = manualSlotPositions[player.id];
      if (manualOverride) {
        return {
          position: manualOverride.position ?? slot.position,
          x: clampPercentageValue(manualOverride.x),
          y: clampPercentageValue(manualOverride.y),
          player,
          slotIndex: idx,
        };
      }

      if (!manual) {
        return { ...slot, player, slotIndex: idx };
      }

      return {
        position: slot.position,
        x: clampPercentageValue(manual.x),
        y: clampPercentageValue(manual.y),
        player,
        slotIndex: idx,
      };
    });
  }, [currentFormation, manualFormation, displayPlayers, manualSlotPositions]);
  const findNearestSlot = useCallback(
    (coords: { x: number; y: number }): PitchSlot | null => {
      if (!formationPositions.length) return null;
      let best: PitchSlot | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      formationPositions.forEach(slot => {
        const dx = slot.x - coords.x;
        const dy = slot.y - coords.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = slot;
        }
      });
      return best;
    },
    [formationPositions],
  );

  const handlePitchDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('text/plain') || draggedPlayerId;
    if (!playerId) {
      return;
    }

    const player = players.find(p => p.id === playerId);
    if (!player) {
      return;
    }

    const coordinates = getPitchCoordinates(e.clientX, e.clientY);
    if (!coordinates) {
      setDraggedPlayerId(null);
      return;
    }

    // GK LOCK LOGIC (Strict No-Swap):
    const isGK = canonicalPosition(player.position) === 'GK';
    const nearestSlot = findNearestSlot(coordinates);
    const finalPosition = nearestSlot?.position ?? player.position;
    const isTargetSlotGK = nearestSlot && canonicalPosition(nearestSlot.position) === 'GK';
    const isTargetOccupied = nearestSlot?.player;

    // Rule 1: If Target is GK Slot AND Occupied -> BLOCK (No Swap allowed)
    if (isTargetSlotGK && isTargetOccupied && nearestSlot.player?.id !== player.id) {
      toast.warning("Kaleci pozisyonu doluyken başka oyuncu eklenemez.");
      setDraggedPlayerId(null);
      return;
    }

    // Rule 2: Strict Type Matching
    if (isGK !== !!isTargetSlotGK) {
      if (isGK) {
        toast.warning("Kaleciler sadece (boş) kaleci pozisyonunda oynayabilir.");
      } else {
        toast.warning("Kaleci pozisyonuna sadece kaleci girebilir.");
      }
      setDraggedPlayerId(null);
      return;
    }

    dropHandledRef.current = true;

    if (player.squadRole === 'starting') {
      if (finalPosition !== player.position) {
        const targetPlayer = nearestSlot?.player;
        if (targetPlayer && targetPlayer.id !== player.id) {
          // SWAP LOGIC
          const originSlot = formationPositions.find(entry => entry.player?.id === player.id);
          setPlayers(prev =>
            normalizePlayers(
              prev.map(current => {
                if (current.id === player.id) return { ...current, position: finalPosition };
                if (current.id === targetPlayer.id) return { ...current, position: originSlot?.position ?? player.position };
                return current;
              }),
            ),
          );

          // Update UI for both players
          applyManualPosition(playerId, {
            x: coordinates.x,
            y: coordinates.y,
            position: finalPosition,
          });
          if (originSlot) {
            applyManualPosition(targetPlayer.id, {
              x: originSlot.x,
              y: originSlot.y,
              position: originSlot.position,
            });
          }

          setFocusedPlayerId(playerId);
          toast.success('Oyuncular yer değiştirdi');
          setDraggedPlayerId(null);
          return;
        }

        setPlayers(prev =>
          normalizePlayers(
            prev.map(current =>
              current.id === playerId ? { ...current, position: finalPosition } : current,
            ),
          ),
        );
      }
      applyManualPosition(playerId, {
        x: coordinates.x,
        y: coordinates.y,
        position: finalPosition,
      });
      setFocusedPlayerId(playerId);
      toast.success('Oyuncu sahada yeniden konumlandirildi');
      setDraggedPlayerId(null);
      return;
    }

    let errorMessage: string | null = null;
    let updated = false;
    let result: PromoteToStartingResult | null = null;

    setPlayers(prev => {
      const promotion = promotePlayerToStartingRoster(prev, playerId, finalPosition);
      result = promotion;
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
      toast.error('Oyuncu eklenemedi', { description: errorMessage });
    } else if (updated) {
      applyManualPosition(playerId, {
        x: coordinates.x,
        y: coordinates.y,
        position: finalPosition,
      });
      if (result?.swappedPlayerId) {
        removePlayerFromCustomFormations(result.swappedPlayerId);
      }
      setFocusedPlayerId(playerId);
      toast.success('Oyuncu sahada konumlandirildi');
    }

    setDraggedPlayerId(null);
  };

  const handlePlayerDragEnd = useCallback(
    (player: Player, event: React.DragEvent<HTMLDivElement>) => {
      setDraggedPlayerId(null);
      if (dropHandledRef.current) {
        dropHandledRef.current = false;
        return;
      }

      if (player.squadRole !== 'starting') {
        return;
      }

      if (event.clientX === 0 && event.clientY === 0) {
        return;
      }

      const coordinates = getPitchCoordinates(event.clientX, event.clientY);
      if (!coordinates) {
        return;
      }

      const nearestSlot = findNearestSlot(coordinates);
      const finalPosition = nearestSlot?.position ?? player.position;

      // GK LOCK LOGIC (Strict No-Swap via DragEnd Fallback)
      const isGK = canonicalPosition(player.position) === 'GK';
      const isTargetSlotGK = nearestSlot && canonicalPosition(nearestSlot.position) === 'GK';
      const isTargetOccupied = nearestSlot?.player;

      // Rule 1: If Target is GK Slot AND Occupied (by someone else) -> BLOCK
      if (isTargetSlotGK && isTargetOccupied && nearestSlot.player?.id !== player.id) {
        toast.warning("Kaleci pozisyonu doluyken başka oyuncu eklenemez.");
        setDraggedPlayerId(null);
        return;
      }

      // Rule 2: Strict Type Matching
      if (isGK !== !!isTargetSlotGK) {
        if (isGK) {
          toast.warning("Kaleciler sadece (boş) kaleci pozisyonunda oynayabilir.");
        } else {
          toast.warning("Kaleci pozisyonuna sadece kaleci girebilir.");
        }
        setDraggedPlayerId(null);
        return;
      }




      if (finalPosition !== player.position) {
        setPlayers(prev =>
          normalizePlayers(
            prev.map(current =>
              current.id === player.id ? { ...current, position: finalPosition } : current,
            ),
          ),
        );
      }

      applyManualPosition(player.id, {
        x: coordinates.x,
        y: coordinates.y,
        position: finalPosition,
      });
    },
    [applyManualPosition, findNearestSlot, getPitchCoordinates, setPlayers],
  );


  const buildPositionsMap = useCallback(
    (slots: PitchSlot[]): Record<string, StorePlayerPosition> =>
      slots.reduce<Record<string, StorePlayerPosition>>((acc, slot) => {
        if (!slot.player) {
          return acc;
        }
        acc[slot.player.id] = {
          x: clampPercentageValue(slot.x),
          y: clampPercentageValue(slot.y),
          position: slot.position,
          slotIndex: slot.slotIndex,
        };
        return acc;
      }, {}),
    [],
  );

  useEffect(() => {
    const positions = buildPositionsMap(formationPositions);
    setPlayerPositions(positions);
    updateFormationFromPositions(positions);
  }, [
    buildPositionsMap,
    formationPositions,
    setPlayerPositions,
    updateFormationFromPositions,
  ]);

  const derivedFormationShape = useMemo(
    () => deriveFormationShape(formationPositions),
    [formationPositions],
  );

  const displayFormationName = useMemo(() => {
    const savedShape = savedFormationShape?.trim();
    if (savedShape) {
      return savedShape;
    }
    return selectedFormation;
  }, [savedFormationShape, selectedFormation]);

  const selectedPlayer = useMemo(() => {
    if (!focusedPlayerId) return null;
    return displayPlayers.find(p => p.id === focusedPlayerId) ?? null;
  }, [displayPlayers, focusedPlayerId]);

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
        zoneId: resolveZoneId(slot),
        x: slot.x,
        y: slot.y,
        position: slot.position,
      });
      setFocusedPlayerId(slot.player ? slot.player.id : null);
      setActiveTab('suggestions');
    },
    [setFocusedPlayerId],
  );

  const getPitchMetricValue = useCallback(
    (player: Player, metric: MetricKey) => {
      let value = 0;
      if (metric === 'power') {
        const index = calculatePowerIndex(player);
        value = normalizeRatingTo100(index);

        // Apply position affinity penalty
        const slot = formationPositions.find(s => s.player?.id === player.id);
        if (slot) {
          const zoneId = resolveZoneId(slot);
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
          case 'condition':
            value = (player.condition ?? 0) * 100;
            break;
          case 'motivation':
            value = (player.motivation ?? 0) * 100;
            break;
        }
      }
      return value;
    },
    [formationPositions],
  );

  useEffect(() => {
    if (!focusedPlayerId) {
      return;
    }
    const slot = formationPositions.find(entry => entry.player?.id === focusedPlayerId);
    if (!slot) {
      return;
    }
    setSelectedSlotMeta(prev => {
      if (prev && prev.slotIndex === slot.slotIndex) {
        return prev;
      }
      return {
        slotIndex: slot.slotIndex,
        zoneId: resolveZoneId(slot),
        x: slot.x,
        y: slot.y,
        position: slot.position,
      };
    });
  }, [focusedPlayerId, formationPositions]);

  useEffect(() => {
    setSelectedSlotMeta(prev => {
      if (!prev) {
        return prev;
      }
      const slot = formationPositions.find(entry => entry.slotIndex === prev.slotIndex);
      if (!slot) {
        return null;
      }
      const nextZone = resolveZoneId(slot);
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
      syncManualSlotsForFormation(formationName);
    },
    [syncManualSlotsForFormation],
  );

  const handlePositionDrop = (
    e: React.DragEvent<HTMLDivElement>,
    slot: PitchSlot,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const playerId = e.dataTransfer.getData('text/plain') || draggedPlayerId;
    if (!playerId) return;

    const draggedPlayer = players.find(p => p.id === playerId);
    if (!draggedPlayer) {
      setDraggedPlayerId(null);
      return;
    }

    const targetPlayer = slot.player ?? null;

    // GK LOCK LOGIC (Strict No-Swap)
    const isGK = canonicalPosition(draggedPlayer.position) === 'GK';
    const isTargetSlotGK = canonicalPosition(slot.position) === 'GK';
    const isTargetOccupied = !!targetPlayer;

    // Rule 1: If Target is GK Slot AND Occupied -> BLOCK (No Swap allowed)
    if (isTargetSlotGK && isTargetOccupied && targetPlayer?.id !== draggedPlayer.id) {
      toast.warning("Kaleci pozisyonu doluyken başka oyuncu eklenemez.");
      setDraggedPlayerId(null);
      return;
    }

    // Rule 2: Strict Type Matching
    if (isGK !== isTargetSlotGK) {
      if (isGK) {
        toast.warning("Kaleciler sadece kaleci pozisyonunda oynayabilir.");
      } else {
        toast.warning("Kaleci pozisyonuna sadece kaleci girebilir.");
      }
      setDraggedPlayerId(null);
      return;
    }

    if (targetPlayer && targetPlayer.id === draggedPlayer.id) {
      dropHandledRef.current = true;
      applyManualPosition(playerId, {
        x: slot.x,
        y: slot.y,
        position: slot.position,
      });
      setFocusedPlayerId(playerId);
      setDraggedPlayerId(null);
      return;
    }

    const previousRole = draggedPlayer.squadRole;
    if (!targetPlayer && previousRole !== 'starting') {
      const startingCount = players.filter(player => player.squadRole === 'starting').length;
      if (startingCount >= 11) {
        toast.error('Pozisyon güncellenemedi', {
          description: 'İlk 11 dolu. Aynı mevkideki bir oyuncuyu çıkarmadan yeni oyuncu ekleyemezsin.',
        });
        setDraggedPlayerId(null);
        return;
      }
    }

    const originSlot =
      formationPositions.find(entry => entry.player?.id === draggedPlayer.id) ?? null;

    let errorMessage: string | null = null;
    let updated = false;

    setPlayers(prev => {
      const draggedState = prev.find(player => player.id === playerId);
      if (!draggedState) {
        errorMessage = 'Oyuncu bulunamad.';
        return prev;
      }

      const targetState = targetPlayer
        ? prev.find(player => player.id === targetPlayer.id) ?? null
        : null;

      if (targetPlayer && !targetState) {
        errorMessage = 'Hedef oyuncu bulunamadı.';
        return prev;
      }

      if (!targetState && draggedState.squadRole !== 'starting') {
        const starters = prev.filter(player => player.squadRole === 'starting').length;
        if (starters >= 11) {
          errorMessage = 'İlk 11 dolu. Aynı mevkideki bir oyuncuyu çıkarmadan yeni oyuncu ekleyemezsin.';
          return prev;
        }
      }

      const next: Player[] = [];

      prev.forEach(current => {
        if (current.id === draggedState.id) {
          if (targetState) {
            if (draggedState.squadRole === 'starting') {
              const updatedTarget: Player = {
                ...targetState,
                squadRole: 'starting',
                position: originSlot?.position ?? draggedState.position,
              };
              next.push(updatedTarget);
            } else {
              const updatedTarget: Player = {
                ...targetState,
                squadRole: draggedState.squadRole,
              };
              next.push(updatedTarget);
            }
          } else {
            const updatedDragged: Player = {
              ...current,
              squadRole: 'starting',
              position: slot.position,
            };
            next.push(updatedDragged);
          }
          updated = true;
          return;
        }

        if (targetState && current.id === targetState.id) {
          const updatedDragged: Player = {
            ...draggedState,
            squadRole: 'starting',
            position: slot.position,
          };
          next.push(updatedDragged);
          return;
        }

        next.push(current);
      });

      if (!updated) {
        errorMessage = 'Pozisyon güncellenemedi.';
        return prev;
      }

      return normalizePlayers(next);
    });

    if (errorMessage) {
      toast.error('Pozisyon güncellenemedi', { description: errorMessage });
      setDraggedPlayerId(null);
      return;
    }

    if (updated) {
      dropHandledRef.current = true;
      applyManualPosition(playerId, {
        x: slot.x,
        y: slot.y,
        position: slot.position,
      });

      if (targetPlayer) {
        if (previousRole === 'starting') {
          if (originSlot) {
            applyManualPosition(targetPlayer.id, {
              x: originSlot.x,
              y: originSlot.y,
              position: originSlot.position,
            });
          } else {
            removePlayerFromCustomFormations(targetPlayer.id);
          }
        } else {
          removePlayerFromCustomFormations(targetPlayer.id);
        }
      }

      setFocusedPlayerId(playerId);
      const successMessage = targetPlayer
        ? previousRole === 'starting'
          ? 'Oyuncular yer değiştirdi'
          : 'Oyuncular değişti'
        : previousRole === 'starting'
          ? 'Oyuncu sahada yeniden konumlandırıldı'
          : 'Oyuncu ilk 11\'e taşındı';
      toast.success(successMessage);
    }

    setDraggedPlayerId(null);
  };

  const handleAlternativeSelection = (alternativeId: string) => {
    if (!selectedSlotMeta) {
      toast.error('Alan seçilmedi', { description: 'Lütfen önce öneri almak istediğin slotu seç.' });
      return;
    }

    const fallbackPosition = selectedPlayer
      ? canonicalPosition(selectedPlayer.position)
      : canonicalPosition(selectedSlotMeta.position);
    const replacementPosition = selectedZoneDefinition?.slotPosition ?? fallbackPosition;

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

    setPlayers(prev => {
      const result = promotePlayerToStartingRoster(prev, alternativeId, replacementPosition, {
        targetPlayerId: selectedPlayer?.id,
      });
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
      toast.error('Oyuncu yerleştirilemedi', { description: errorMessage });
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
        },
        formation,
      );
    });
    if (selectedPlayer) {
      removePlayerFromCustomFormations(selectedPlayer.id);
    }
    if (swappedPlayerId && (!selectedPlayer || swappedPlayerId !== selectedPlayer.id)) {
      removePlayerFromCustomFormations(swappedPlayerId);
    }

    applyManualPosition(alternativeId, {
      x: selectedSlotMeta.x,
      y: selectedSlotMeta.y,
      position: replacementPosition,
    });

    setFocusedPlayerId(alternativeId);
    setActiveTab('starting');
    toast.success('Oyuncu ilk 11\'e taşındı');
  };

  return (
    <>
      <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-black text-white">
        <header
          id="tp-topbar"
          className="flex flex-shrink-0 items-center justify-between border-b border-white/10 bg-black/30 px-5 py-0 backdrop-blur"
        >
          <div className="flex items-center gap-2.5">
            <BackButton />
            <div>
              <h1 className="text-base font-semibold sm:text-lg">Takım Planı</h1>
              <p className="text-[11px] text-orange-100/70 sm:text-xs">
                Formasyonunuzu yönetin ve kadronuzu düzenleyin
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center">
              <Select value={selectedFormation} onValueChange={handleFormationSelect}>
                <SelectTrigger className="h-9 border-white/30 bg-white/10 px-3 text-xs text-white shadow-sm transition hover:bg-white/20 hover:text-white sm:text-sm w-[140px]">
                  <div className="flex items-center">
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    <span>{displayFormationName || 'Formasyon'}</span>
                  </div>
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {formations.map(formation => (
                    <SelectItem key={formation.name} value={formation.name}>
                      {formation.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={handleSave}
              className="tp-topbar-button bg-emerald-400 text-emerald-950 shadow-lg transition hover:bg-emerald-300 h-9 px-3 text-xs sm:text-sm"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Kaydet
            </Button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden relative justify-start items-stretch">
          <section
            id="tp-left"
            style={{
              width: isListCollapsed ? '100%' : '60%',
              flex: isListCollapsed ? '0 0 100%' : '0 0 60%',
              maxWidth: isListCollapsed ? '100%' : '60%'
            }}
            className="relative h-full transition-all duration-300 ease-in-out min-w-0 bg-transparent m-0 p-0 flex flex-col shrink-0"
          >
            <div id="tp-pitch-wrapper" className="flex-1 w-full h-full bg-transparent m-0 p-0 block relative min-h-0">
              <Pitch
                ref={pitchRef}
                slots={formationPositions}
                onPitchDrop={handlePitchDrop}
                onPositionDrop={handlePositionDrop}
                onPlayerDragStart={player => {
                  setDraggedPlayerId(player.id);
                  // Zoom removed
                }}
                onPlayerDragEnd={handlePlayerDragEnd}
                onSelectPlayer={playerId => {
                  const items = formationPositions;
                  const slot = items.find(s => s.player?.id === playerId);
                  if (slot) {
                    handleSlotSelect(slot);
                    setFocusedPlayerId(playerId);
                  }
                }}
                onSelectSlot={handleSlotSelect}
                focusedPlayerId={focusedPlayerId}
                selectedMetric={selectedMetric}
                getMetricValue={getPitchMetricValue}
                renderTooltip={renderPitchTooltip}
                isExpanded={isListCollapsed}
                onBackgroundClick={() => {
                  setSelectedSlotMeta(null);
                  setFocusedPlayerId(null);
                  setActiveTab('starting');
                }}
              />
            </div>
          </section>

          <aside
            className={cn(
              "flex flex-col h-full overflow-hidden border-l border-white/10 bg-black/35 transition-all duration-300 ease-in-out absolute right-0 top-0 bottom-0 z-20 shadow-2xl backdrop-blur-md",
              isListCollapsed ? "translate-x-[calc(100%-24px)]" : "translate-x-0 w-[40%]"
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
              style={{ contain: 'layout paint', willChange: 'transform' }}
            >
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex h-full flex-col"
                style={{ contain: 'layout paint', willChange: 'transform' }}
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
                          placeholder="Oyuncu ara..."
                          value={searchTerm}
                          onChange={event => setSearchTerm(event.target.value)}
                          className="h-6 border-white/20 bg-white/10 pl-6 text-[9px] text-white placeholder:text-orange-100/50 focus-visible:ring-orange-500/50"
                        />
                      </div>
                      <Select
                        value={sortBy}
                        onValueChange={value => setSortBy(value as 'role' | 'overall' | 'potential')}
                      >
                        <SelectTrigger className="h-6 border-white/20 bg-white/10 text-[9px] text-white focus:ring-orange-500/50 sm:w-24">
                          <SelectValue placeholder="Sırala" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="role">Role göre</SelectItem>
                          <SelectItem value="overall">Ortalamaya göre</SelectItem>
                          <SelectItem value="potential">Maks. potansiyel</SelectItem>
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
                        Öneriler
                      </TabsTrigger>
                      <TabsTrigger
                        value="starting"
                        className="rounded-full px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-orange-100 data-[state=active]:bg-orange-500 data-[state=active]:text-white"
                      >
                        İlk 11 ({startingEleven.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="bench"
                        className="rounded-full px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-orange-100 data-[state=active]:bg-orange-500 data-[state=active]:text-white"
                      >
                        Yedek ({benchPlayers.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="reserve"
                        className="rounded-full px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-orange-100 data-[state=active]:bg-orange-500 data-[state=active]:text-white"
                      >
                        Rezerv ({reservePlayers.length})
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
                          <p className="text-sm">Bir oyuncu slotu seçin.</p>
                        </div>
                      ) : recommendedPlayers.length === 0 ? (
                        <Card className="border-white/10 bg-white/5 text-center text-white shadow-lg backdrop-blur">
                          <CardContent className="p-8">
                            <div className="mb-4 text-4xl">⚽</div>
                            <h3 className="mb-2 text-base font-semibold">Öneri Bulunamadı</h3>
                            <p className="text-sm text-emerald-100/70">
                              Bu pozisyon için uygun oyuncu yok.
                            </p>
                          </CardContent>
                        </Card>
                      ) : (
                        <>
                          <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <h3 className="font-semibold text-orange-100">
                              {selectedZoneDefinition?.label} Önerileri
                            </h3>
                            <span className="text-xs text-orange-100/60">
                              {recommendedPlayers.length} Oyuncu
                            </span>
                          </div>
                          {recommendedPlayers.map(player => {
                            const canAdjustContract = getLegendIdFromPlayer(player) === null;
                            const metricValue = getPitchMetricValue(player, selectedMetric);
                            return (
                              <PlayerCard
                                key={player.id}
                                player={player}
                                leagueId={teamLeagueIdRef.current}
                                ratingAnnotation={String(Math.round(metricValue))}
                                compact
                                defaultCollapsed
                                onSelect={() => handleAlternativeSelection(player.id)}
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
                            <h3 className="mb-2 text-base font-semibold">İlk 11'inizi oluşturun</h3>
                            <p className="text-sm text-emerald-100/70">
                              Yedek kulübesinden oyuncularınızı ilk 11'e taşıyın.
                            </p>
                          </CardContent>
                        </Card>
                      ) : (
                        sortedPlayers.map(player => {
                          const canAdjustContract = getLegendIdFromPlayer(player) === null;
                          return (
                            <PlayerCard
                              key={player.id}
                              player={player}
                              leagueId={teamLeagueIdRef.current}
                              ratingAnnotation={getRatingAnnotation(player)}
                              compact
                              defaultCollapsed
                              draggable
                              onDragStart={event => {
                                setDraggedPlayerId(player.id);
                                event.dataTransfer.setData('text/plain', player.id);
                              }}
                              onDragEnd={() => setDraggedPlayerId(null)}
                              onMoveToBench={() => movePlayer(player.id, 'bench')}
                              onMoveToReserve={() => movePlayer(player.id, 'reserve')}
                              onListForTransfer={() => handleListForTransfer(player.id)}
                              onRenamePlayer={() => setRenamePlayerId(player.id)}
                              onFirePlayer={() => handleFirePlayer(player.id)}
                              onNegotiateSalary={
                                canAdjustContract ? () => openSalaryNegotiation(player.id) : undefined
                              }
                              onExtendContract={
                                canAdjustContract ? () => handleExtendContract(player.id) : undefined
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
                            <h3 className="mb-2 text-base font-semibold">Yedek kulübesi boş</h3>
                            <p className="text-sm text-emerald-100/70">
                              Rezerv oyuncularınızı yedek kulübesine taşıyın.
                            </p>
                          </CardContent>
                        </Card>
                      ) : (
                        sortedPlayers.map(player => {
                          const canAdjustContract = getLegendIdFromPlayer(player) === null;
                          return (
                            <PlayerCard
                              key={player.id}
                              player={player}
                              leagueId={teamLeagueIdRef.current}
                              ratingAnnotation={getRatingAnnotation(player)}
                              compact
                              defaultCollapsed
                              draggable
                              onDragStart={event => {
                                setDraggedPlayerId(player.id);
                                event.dataTransfer.setData('text/plain', player.id);
                              }}
                              onDragEnd={() => setDraggedPlayerId(null)}
                              onMoveToStarting={() => movePlayer(player.id, 'starting')}
                              onMoveToReserve={() => movePlayer(player.id, 'reserve')}
                              onListForTransfer={() => handleListForTransfer(player.id)}
                              onRenamePlayer={() => setRenamePlayerId(player.id)}
                              onFirePlayer={() => handleFirePlayer(player.id)}
                              onNegotiateSalary={
                                canAdjustContract ? () => openSalaryNegotiation(player.id) : undefined
                              }
                              onExtendContract={
                                canAdjustContract ? () => handleExtendContract(player.id) : undefined
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
                            <h3 className="mb-2 text-base font-semibold">Rezerv oyuncu yok</h3>
                            <p className="text-sm text-emerald-100/70">
                              Altyapıdan oyuncu alın veya pazardan oyuncu satın.
                            </p>
                          </CardContent>
                        </Card>
                      ) : (
                        sortedPlayers.map(player => {
                          const canAdjustContract = getLegendIdFromPlayer(player) === null;
                          return (
                            <PlayerCard
                              key={player.id}
                              player={player}
                              leagueId={teamLeagueIdRef.current}
                              ratingAnnotation={getRatingAnnotation(player)}
                              compact
                              defaultCollapsed
                              draggable
                              onDragStart={event => {
                                setDraggedPlayerId(player.id);
                                event.dataTransfer.setData('text/plain', player.id);
                              }}
                              onDragEnd={() => setDraggedPlayerId(null)}
                              onMoveToStarting={() => movePlayer(player.id, 'starting')}
                              onMoveToBench={() => movePlayer(player.id, 'bench')}
                              onListForTransfer={() => handleListForTransfer(player.id)}
                              onRenamePlayer={() => setRenamePlayerId(player.id)}
                              onFirePlayer={() => handleFirePlayer(player.id)}
                              onNegotiateSalary={
                                canAdjustContract ? () => openSalaryNegotiation(player.id) : undefined
                              }
                              onExtendContract={
                                canAdjustContract ? () => handleExtendContract(player.id) : undefined
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
        </div >
      </div >

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
        onRenameWithAd={() => handleRenamePlayer('ad')}
        onRenameWithPurchase={() => handleRenamePlayer('purchase')}
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
        onRelease={() => activeContractPlayer && handleReleaseContract(activeContractPlayer.id)}
        onExtend={() => activeContractPlayer && handleExtendContract(activeContractPlayer.id)}
      />

      <PlayerDetailOverlay
        isOpen={isDetailOverlayOpen}
        onClose={() => setIsDetailOverlayOpen(false)}
        player={selectedPlayer}
        onMoveToStarting={(id) => { movePlayer(id, 'starting'); setIsDetailOverlayOpen(false); }}
        onMoveToBench={(id) => { movePlayer(id, 'bench'); setIsDetailOverlayOpen(false); }}
        onMoveToReserve={(id) => { movePlayer(id, 'reserve'); setIsDetailOverlayOpen(false); }}
        onRename={(id) => { setRenamePlayerId(id); setIsDetailOverlayOpen(false); }}
        onNegotiateSalary={(id) => { openSalaryNegotiation(id); setIsDetailOverlayOpen(false); }}
        onSellPlayer={(id) => { handleListForTransfer(id); setIsDetailOverlayOpen(false); }}
        onExtendContract={(id) => { handleExtendContract(id); setIsDetailOverlayOpen(false); }}
        onFirePlayer={(id) => { handleFirePlayer(id); setIsDetailOverlayOpen(false); }}
        onReleasePlayer={(id) => { handleReleaseContract(id); setIsDetailOverlayOpen(false); }}
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

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
import { Search, Save, Eye, X } from 'lucide-react';
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
import { formatRatingLabel, normalizeRatingTo100 } from '@/lib/player';
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
import './team-planning.css';
import './TeamPlanningSizing.css';

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
        errorMessage = 'Oyuncu bulunamad.';
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
        `${negotiationPlayer.name} maa?? ${formatSalary(clampedOffer)} oldu ve s?zle?mesi ${CONTRACT_EXTENSION_MONTHS} ay uzat?ld?.`,
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
      : `Kabul edilmedi. Oyuncunun kar?? teklifi: ${formatSalary(counter)}. Kalan hak: ${remainingAttempts}`;
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
          status: 'released',
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

    const relativeX = ((clientX - rect.left) / rect.width) * 100;
    const relativeY = ((clientY - rect.top) / rect.height) * 100;

    if (Number.isNaN(relativeX) || Number.isNaN(relativeY)) {
      return null;
    }

    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }

    return {
      x: clampPercentageValue(relativeX),
      y: clampPercentageValue(relativeY),
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
    },
    [],
  );

  const getMetricValueForPlayer = useCallback(
    (player: DisplayPlayer, metric: MetricKey): number => {
      switch (metric) {
        case 'motivation':
          return clampPercentageValue(getPlayerMotivation(player) * 100);
        case 'condition':
          return clampPercentageValue(getPlayerCondition(player) * 100);
        default:
          return normalizeRatingTo100(getPlayerPower(player));
      }
    },
    [],
  );

  const renderPitchTooltip = useCallback(
    (player: DisplayPlayer) => (
      <div className="space-y-2">
        <div className="text-xs font-semibold">{player.name}</div>
        <PerformanceGauge
          label="Guç"
          value={normalizeRatingTo100(getPlayerPower(player)) / 100}
          variant="dark"
        />
        <PerformanceGauge
          label="Kondisyon"
          value={getPlayerCondition(player)}
          variant="dark"
        />
        <PerformanceGauge
          label="Motivasyon"
          value={getPlayerMotivation(player)}
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

  useEffect(() => {
    if (!user) return;
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
    })();
  }, [user]);

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

    dropHandledRef.current = true;

    const nearestSlot = findNearestSlot(coordinates);
    const finalPosition = nearestSlot?.position ?? player.position;

    if (player.squadRole === 'starting') {
      if (finalPosition !== player.position) {
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
    (event: React.DragEvent<HTMLDivElement>, player: Player) => {
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
    const manualShape = derivedFormationShape?.trim();
    if (manualShape) {
      return manualShape;
    }
    const savedShape = savedFormationShape?.trim();
    if (savedShape) {
      return savedShape;
    }
    return selectedFormation;
  }, [derivedFormationShape, savedFormationShape, selectedFormation]);

  const manualShapeDiffers = useMemo(() => {
    if (!derivedFormationShape) {
      return false;
    }
    return derivedFormationShape.trim() !== selectedFormation.trim();
  }, [derivedFormationShape, selectedFormation]);

  const selectedPlayer = useMemo(() => {
    if (!focusedPlayerId) return null;
    return displayPlayers.find(p => p.id === focusedPlayerId) ?? null;
  }, [displayPlayers, focusedPlayerId]);

  const selectedPlayerTargetPosition = useMemo(() => {
    if (!selectedPlayer) {
      return null;
    }
    const assignedSlot = formationPositions.find(
      slot => slot.player && slot.player.id === selectedPlayer.id,
    );
    if (assignedSlot) {
      return canonicalPosition(assignedSlot.position);
    }
    return canonicalPosition(selectedPlayer.position);
  }, [formationPositions, selectedPlayer]);

  const alternativePlayers: DisplayPlayer[] = useMemo(() => {
    if (!selectedPlayer || !selectedPlayerTargetPosition) {
      return [] as DisplayPlayer[];
    }

    const target = selectedPlayerTargetPosition;

    const alternatives = displayPlayers.filter(player => {
      if (player.id === selectedPlayer.id) {
        return false;
      }
      if (player.squadRole !== 'bench' && player.squadRole !== 'reserve') {
        return false;
      }
      const primary = canonicalPosition(player.position);
      if (primary === target) {
        return true;
      }
      return (player.roles ?? []).some(role => canonicalPosition(role) === target);
    });

    return alternatives.sort((a, b) => {
      const roleDiff = squadRoleWeight(a.squadRole) - squadRoleWeight(b.squadRole);
      if (roleDiff !== 0) {
        return roleDiff;
      }
      return b.overall - a.overall;
    });
  }, [displayPlayers, selectedPlayer, selectedPlayerTargetPosition]);

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
        toast.error('Pozisyon gncellenemedi', {
          description: 'ilk 11 dolu. Ayn mevkideki bir oyuncuyu çıkarmadan yeni oyuncu ekleyemezsin.',
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
          errorMessage = 'ilk 11 dolu. Aynı mevkideki bir oyuncuyu çıkarmadan yeni oyuncu ekleyemezsin.';
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
          ? 'Oyuncular yer degistirdi'
          : 'Oyuncular degisti'
        : previousRole === 'starting'
          ? 'Oyuncu sahada yeniden konumlandırıldı'
          : 'Oyuncu ilk 11\'e taşındı';
      toast.success(successMessage);
    }

    setDraggedPlayerId(null);
  };

  const handleAlternativeSelection = (alternativeId: string) => {
    if (!selectedPlayer) {
      return;
    }
    const replacementPosition =
      selectedPlayerTargetPosition ?? canonicalPosition(selectedPlayer.position);

    const manualLayouts = Object.entries(customFormations).reduce<
      Array<{ formation: string; layout: FormationPlayerPosition }>
    >((acc, [formationKey, layout]) => {
      const entry = layout?.[selectedPlayer.id];
      if (entry) {
        acc.push({ formation: formationKey, layout: entry });
      }
      return acc;
    }, []);

    let errorMessage: string | null = null;
    let updated = false;
    let swappedPlayerId: string | null = null;

    setPlayers(prev => {
      const result = promotePlayerToStartingRoster(prev, alternativeId, replacementPosition, {
        targetPlayerId: selectedPlayer.id,
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
      toast.error('Oyuncu yerle�Ytirilemedi', { description: errorMessage });
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
    removePlayerFromCustomFormations(selectedPlayer.id);
    if (swappedPlayerId && swappedPlayerId !== selectedPlayer.id) {
      removePlayerFromCustomFormations(swappedPlayerId);
    }

    setFocusedPlayerId(alternativeId);
    setActiveTab('starting');
    toast.success('Oyuncu ilk 11\'e taşındı');
  };

  return (
    <>
      <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-br from-emerald-900 via-emerald-950 to-slate-950 text-white">
        <header
          id="tp-topbar"
          className="flex flex-shrink-0 items-center justify-between border-b border-white/10 bg-black/30 px-5 py-0 backdrop-blur"
        >
          <div className="flex items-center gap-2.5">
            <BackButton />
            <div>
              <h1 className="text-base font-semibold sm:text-lg">Takım Planı</h1>
              <p className="text-[11px] text-emerald-100/70 sm:text-xs">
                Formasyonunuzu yönetin ve kadronuzu düzenleyin
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="tp-topbar-button border-white/30 bg-white/10 text-white shadow-sm transition hover:bg-white/20 hover:text-white h-9 px-3 text-xs sm:text-sm"
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Formasyon
            </Button>
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

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[1.12fr_0.88fr]">
          <section id="tp-left" className="relative h-full overflow-hidden">
            <div id="tp-pitch-wrapper" className="tp-pitch-shell h-full w-full">
              <Pitch
                ref={pitchRef}
                slots={formationPositions}
                onPitchDrop={handlePitchDrop}
                onPositionDrop={handlePositionDrop}
                onPlayerDragStart={handlePitchMarkerDragStart}
                onPlayerDragEnd={handlePitchMarkerDragStart}
                onSelectPlayer={playerId => setFocusedPlayerId(playerId)}
                focusedPlayerId={focusedPlayerId}
                selectedMetric={selectedMetric}
                getMetricValue={getMetricValueForPlayer}
                renderTooltip={renderPitchTooltip}
              />
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-start p-5 sm:p-6">
              <div className="pointer-events-auto flex flex-col gap-2.5">
                <div className="tp-formation-card pointer-events-auto flex max-w-[15rem] flex-col gap-2 rounded-3xl border border-white/20 bg-black/40 p-[0.8rem] shadow-xl backdrop-blur">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-100/80">Formasyon</span>
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-xl font-bold text-white">{displayFormationName}</span>
                    {manualShapeDiffers ? (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-100">
                        {selectedFormation}
                      </span>
                    ) : null}
                  </div>
                  <Select value={selectedFormation} onValueChange={setSelectedFormation}>
                    <SelectTrigger className="w-full border-white/20 bg-white/10 text-white focus:ring-white/50">
                      <SelectValue placeholder="Formasyon sec" />
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
                <div className="tp-squad-count-card hidden max-w-[10rem] rounded-3xl border border-white/20 bg-black/40 px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wide text-emerald-100 shadow-xl backdrop-blur sm:flex sm:flex-col sm:items-start sm:gap-1.5">
                  <span>Ilk 11 - {startingEleven.length}</span>
                  <span>Yedek - {benchPlayers.length}</span>
                  <span>Rezerv - {reservePlayers.length}</span>
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-start p-6">
              <div
                id="tp-metric-panel"
                className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/40 p-1 shadow-xl backdrop-blur"
              >
                {metricOptions.map(option => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSelectedMetric(option.key)}
                    className={cn(
                      'rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-wider transition duration-150',
                      selectedMetric === option.key
                        ? 'bg-emerald-400 text-emerald-950 shadow'
                        : 'text-emerald-100 hover:bg-white/10',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="flex h-full flex-col overflow-hidden border-l border-white/10 bg-black/35">
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
                  <div className="px-6 py-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-100/60" />
                        <Input
                          placeholder="Oyuncu ara..."
                          value={searchTerm}
                          onChange={event => setSearchTerm(event.target.value)}
                          className="border-white/20 bg-white/10 pl-9 text-white placeholder:text-emerald-100/50 focus-visible:ring-white/50"
                        />
                      </div>
                      <Select
                        value={sortBy}
                        onValueChange={value => setSortBy(value as 'role' | 'overall' | 'potential')}
                      >
                        <SelectTrigger className="border-white/20 bg-white/10 text-white focus:ring-white/50 sm:w-40">
                          <SelectValue placeholder="Sırala" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="role">Role göre</SelectItem>
                          <SelectItem value="overall">Ortalamaya göre</SelectItem>
                          <SelectItem value="potential">Maks. potansiyel</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <TabsList className="mt-4 grid grid-cols-3 gap-2 rounded-full bg-white/10 p-1">
                      <TabsTrigger
                        value="starting"
                        className="rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 data-[state=active]:bg-emerald-400 data-[state=active]:text-emerald-950"
                      >
                        İlk 11 ({startingEleven.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="bench"
                        className="rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 data-[state=active]:bg-emerald-400 data-[state=active]:text-emerald-950"
                      >
                        Yedek ({benchPlayers.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="reserve"
                        className="rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 data-[state=active]:bg-emerald-400 data-[state=active]:text-emerald-950"
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
                    {selectedPlayer ? (
                      <Card className="border-white/10 bg-white/5 text-white shadow-lg backdrop-blur">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold text-white">
                          {getPositionLabel(selectedPlayerTargetPosition ?? selectedPlayer.position)} için alternatifler
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {alternativePlayers.length > 0 ? (
                          <div className="grid gap-[6px] sm:grid-cols-2">
                            {alternativePlayers.map(alternative => (
                              <AlternativePlayerBubble
                                key={alternative.id}
                                player={alternative}
                                onSelect={playerId => handleAlternativeSelection(playerId)}
                                variant="panel"
                                compareToPlayer={selectedPlayer}
                              />
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-emerald-100/70">
                            Bu pozisyon için yedek veya rezerv oyuncu bulunmadı.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ) : null}

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

    </>
  );
}

export default function TeamPlanning() 
{
  return (
    <TeamPlanningProvider>
      <TeamPlanningContent />
    </TeamPlanningProvider>
  );
}

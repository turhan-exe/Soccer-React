import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Player } from '@/types';

export type MetricKey = 'power' | 'motivation' | 'condition';

export type PlayerPosition = {
  x: number;
  y: number;
  position: Player['position'];
  slotIndex?: number;
};

type TeamPlanningStoreValue = {
  selectedMetric: MetricKey;
  setSelectedMetric: (metric: MetricKey) => void;
  playerPositions: Record<string, PlayerPosition>;
  setPlayerPositions: (positions: Record<string, PlayerPosition>) => void;
  updateFormationFromPositions: (positions: Record<string, PlayerPosition>) => void;
  registerFormationUpdater: (
    updater: (positions: Record<string, PlayerPosition>) => void,
  ) => void;
};

const TeamPlanningContext = createContext<TeamPlanningStoreValue | null>(null);

export const TeamPlanningProvider = ({
  children,
}: React.PropsWithChildren) => {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('power');
  const [playerPositions, setPlayerPositions] = useState<
    Record<string, PlayerPosition>
  >({});
  const formationUpdaterRef = useRef<
    ((positions: Record<string, PlayerPosition>) => void) | null
  >(null);

  const updateFormationFromPositions = useCallback(
    (positions: Record<string, PlayerPosition>) => {
      setPlayerPositions(positions);
      formationUpdaterRef.current?.(positions);
    },
    [],
  );

  const registerFormationUpdater = useCallback(
    (updater: (positions: Record<string, PlayerPosition>) => void) => {
      formationUpdaterRef.current = updater;
    },
    [],
  );

  const value = useMemo<TeamPlanningStoreValue>(
    () => ({
      selectedMetric,
      setSelectedMetric,
      playerPositions,
      setPlayerPositions,
      updateFormationFromPositions,
      registerFormationUpdater,
    }),
    [
      selectedMetric,
      playerPositions,
      updateFormationFromPositions,
      registerFormationUpdater,
    ],
  );

  return React.createElement(
    TeamPlanningContext.Provider,
    { value },
    children,
  );
};

export const useTeamPlanningStore = (): TeamPlanningStoreValue => {
  const context = useContext(TeamPlanningContext);
  if (!context) {
    throw new Error(
      'useTeamPlanningStore must be used within a TeamPlanningProvider',
    );
  }
  return context;
};

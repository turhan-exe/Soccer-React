import { calculateOverall } from '@/lib/player';
import type { Player, Training } from '@/types';

export type TrainingSimulationRecord = {
  playerId: string;
  playerName: string;
  trainingId: string;
  trainingName: string;
  result: 'success' | 'average' | 'fail';
  gain: number;
};

export type TrainingSimulationResult = {
  updatedPlayers: Player[];
  records: TrainingSimulationRecord[];
};

export function runTrainingSimulation(
  players: Player[],
  trainings: Training[],
  rng: () => number = Math.random,
): TrainingSimulationResult {
  const records: TrainingSimulationRecord[] = [];
  const updatedPlayers: Player[] = [];

  for (const player of players) {
    let snapshot: Player = {
      ...player,
      attributes: { ...player.attributes },
    };

    for (const training of trainings) {
      const attributeKey = training.type;
      const currentValue = snapshot.attributes[attributeKey];
      let gain = 0;
      let result: 'success' | 'average' | 'fail' = 'fail';

      if (currentValue < 1) {
        const improvement = 0.005 + rng() * 0.03;
        const successRoll = rng() * 100;

        if (successRoll > 75) {
          gain = improvement;
          result = 'success';
        } else if (successRoll > 45) {
          gain = improvement * 0.5;
          result = 'average';
        } else {
          result = 'fail';
        }

        if (gain > 0) {
          const newValue = Math.min(currentValue + gain, 1);
          const newAttributes = {
            ...snapshot.attributes,
            [attributeKey]: newValue,
          } as Player['attributes'];

          snapshot = {
            ...snapshot,
            attributes: newAttributes,
            overall: Math.min(
              calculateOverall(snapshot.position, newAttributes),
              snapshot.potential,
            ),
          };
        }
      }

      records.push({
        playerId: snapshot.id,
        playerName: snapshot.name,
        trainingId: training.id,
        trainingName: training.name,
        result,
        gain,
      });
    }

    updatedPlayers.push(snapshot);
  }

  return { updatedPlayers, records };
}

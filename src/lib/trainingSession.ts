import { calculateOverall } from '@/lib/player';
import { applyTrainingVitalsLoss } from '@/lib/playerVitals';
import { resolveTrainingOutcome, type TrainingResult } from '@/lib/trainingResults';
import type { Player, Training } from '@/types';

export type TrainingSimulationRecord = {
  playerId: string;
  playerName: string;
  trainingId: string;
  trainingName: string;
  result: TrainingResult;
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
      let result: TrainingResult = 'fail';

      if (currentValue < 1) {
        const improvement = 0.005 + rng() * 0.03;
        const successRoll = rng() * 100;
        const outcome = resolveTrainingOutcome(successRoll);
        gain = improvement * outcome.gainMultiplier;
        result = outcome.result;

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

    updatedPlayers.push(applyTrainingVitalsLoss(snapshot));
  }

  return { updatedPlayers, records };
}

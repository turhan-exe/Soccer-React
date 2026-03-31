type Position =
  | 'GK'
  | 'CB'
  | 'LB'
  | 'RB'
  | 'CM'
  | 'LM'
  | 'RM'
  | 'CAM'
  | 'LW'
  | 'RW'
  | 'ST';

type PlayerAttributes = {
  strength: number;
  acceleration: number;
  topSpeed: number;
  dribbleSpeed: number;
  jump: number;
  tackling: number;
  ballKeeping: number;
  passing: number;
  longBall: number;
  agility: number;
  shooting: number;
  shootPower: number;
  positioning: number;
  reaction: number;
  ballControl: number;
};

export type TrainingPlayer = {
  id: string;
  name: string;
  position: Position;
  overall: number;
  potential: number;
  attributes: PlayerAttributes;
};

export type TrainingDefinition = {
  id: string;
  name: string;
  type: keyof PlayerAttributes;
  aliases?: string[];
};

const trainings: TrainingDefinition[] = [
  { id: 'topSpeed', name: 'Top Speed', type: 'topSpeed', aliases: ['top-speed'] },
  { id: 'shooting', name: 'Shooting', type: 'shooting' },
  { id: 'passing', name: 'Passing', type: 'passing' },
  { id: 'strength', name: 'Strength', type: 'strength' },
  { id: 'acceleration', name: 'Acceleration', type: 'acceleration' },
  { id: 'ballControl', name: 'Ball Control', type: 'ballControl', aliases: ['ball-control'] },
  { id: 'dribbleSpeed', name: 'Dribble Speed', type: 'dribbleSpeed', aliases: ['dribble-speed'] },
  { id: 'tackling', name: 'Tackling', type: 'tackling' },
  { id: 'shootPower', name: 'Shoot Power', type: 'shootPower', aliases: ['shoot-power'] },
  { id: 'positioning', name: 'Positioning', type: 'positioning' },
  { id: 'reaction', name: 'Reaction', type: 'reaction' },
  { id: 'agility', name: 'Agility', type: 'agility' },
  { id: 'jump', name: 'Jump', type: 'jump' },
  { id: 'longBall', name: 'Long Ball', type: 'longBall', aliases: ['long-ball'] },
  { id: 'ballKeeping', name: 'Ball Keeping', type: 'ballKeeping', aliases: ['ball-keeping'] },
];

type TrainingResult =
  | 'fail'
  | 'very_low'
  | 'low'
  | 'medium'
  | 'high'
  | 'full';

type TrainingOutcome = {
  result: TrainingResult;
  gainMultiplier: number;
  upperBoundExclusive: number;
};

const TRAINING_OUTCOMES: TrainingOutcome[] = [
  { upperBoundExclusive: 1, result: 'fail', gainMultiplier: 0 },
  { upperBoundExclusive: 26, result: 'very_low', gainMultiplier: 0.1 },
  { upperBoundExclusive: 50, result: 'low', gainMultiplier: 0.25 },
  { upperBoundExclusive: 75, result: 'medium', gainMultiplier: 0.5 },
  { upperBoundExclusive: 90, result: 'high', gainMultiplier: 0.75 },
  { upperBoundExclusive: 101, result: 'full', gainMultiplier: 1 },
];

const normalizeTrainingId = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const trainingLookup = new Map<string, TrainingDefinition>();

for (const training of trainings) {
  trainingLookup.set(normalizeTrainingId(training.id), training);
  for (const alias of training.aliases ?? []) {
    trainingLookup.set(normalizeTrainingId(alias), training);
  }
}

const POSITION_ATTRIBUTES: Record<Position, (keyof PlayerAttributes)[]> = {
  GK: ['positioning', 'reaction', 'longBall', 'strength', 'jump'],
  CB: ['strength', 'tackling', 'jump', 'positioning', 'reaction'],
  LB: ['acceleration', 'topSpeed', 'tackling', 'passing', 'agility'],
  RB: ['acceleration', 'topSpeed', 'tackling', 'passing', 'agility'],
  CM: ['passing', 'ballControl', 'ballKeeping', 'agility', 'reaction'],
  LM: ['acceleration', 'topSpeed', 'dribbleSpeed', 'passing', 'ballControl'],
  RM: ['acceleration', 'topSpeed', 'dribbleSpeed', 'passing', 'ballControl'],
  CAM: ['passing', 'ballControl', 'shooting', 'agility', 'reaction'],
  LW: ['topSpeed', 'dribbleSpeed', 'shooting', 'ballControl', 'passing'],
  RW: ['topSpeed', 'dribbleSpeed', 'shooting', 'ballControl', 'passing'],
  ST: ['shooting', 'shootPower', 'positioning', 'strength', 'topSpeed'],
};

const calculateOverall = (position: Position, attributes: PlayerAttributes) => {
  const keys = POSITION_ATTRIBUTES[position] || POSITION_ATTRIBUTES.CM;
  const total = keys.reduce((sum, key) => sum + Number(attributes[key] || 0), 0);
  return Number((total / keys.length).toFixed(3));
};

export const resolveTrainingDefinitions = (ids: string[]) =>
  ids
    .map((id) => trainingLookup.get(normalizeTrainingId(id)))
    .filter((training): training is TrainingDefinition => Boolean(training));

const resolveTrainingOutcome = (rollPercent: number): TrainingOutcome => {
  const normalizedRoll = Number.isFinite(rollPercent)
    ? Math.max(0, Math.min(100, rollPercent))
    : 0;

  return (
    TRAINING_OUTCOMES.find(outcome => normalizedRoll < outcome.upperBoundExclusive)
    ?? TRAINING_OUTCOMES[0]
  );
};

export function runTrainingSimulation(
  players: TrainingPlayer[],
  trainingDefs: TrainingDefinition[],
  rng: () => number = Math.random,
) {
  const records: Array<{
    playerId: string;
    playerName: string;
    trainingId: string;
    trainingName: string;
    result: TrainingResult;
    gain: number;
  }> = [];
  const updatedPlayers: TrainingPlayer[] = [];

  for (const player of players) {
    let snapshot: TrainingPlayer = {
      ...player,
      attributes: { ...player.attributes },
    };

    for (const training of trainingDefs) {
      const attributeKey = training.type;
      const currentValue = Number(snapshot.attributes[attributeKey] || 0);
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
          const attributes = {
            ...snapshot.attributes,
            [attributeKey]: newValue,
          } as PlayerAttributes;

          snapshot = {
            ...snapshot,
            attributes,
            overall: Math.min(calculateOverall(snapshot.position, attributes), snapshot.potential),
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

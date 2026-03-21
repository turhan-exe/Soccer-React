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
};

const trainings: TrainingDefinition[] = [
  { id: 'top-speed', name: 'Top Speed', type: 'topSpeed' },
  { id: 'shooting', name: 'Shooting', type: 'shooting' },
  { id: 'passing', name: 'Passing', type: 'passing' },
  { id: 'strength', name: 'Strength', type: 'strength' },
  { id: 'acceleration', name: 'Acceleration', type: 'acceleration' },
  { id: 'ball-control', name: 'Ball Control', type: 'ballControl' },
  { id: 'dribble-speed', name: 'Dribble Speed', type: 'dribbleSpeed' },
  { id: 'tackling', name: 'Tackling', type: 'tackling' },
  { id: 'shoot-power', name: 'Shoot Power', type: 'shootPower' },
  { id: 'positioning', name: 'Positioning', type: 'positioning' },
  { id: 'reaction', name: 'Reaction', type: 'reaction' },
  { id: 'agility', name: 'Agility', type: 'agility' },
  { id: 'jump', name: 'Jump', type: 'jump' },
  { id: 'long-ball', name: 'Long Ball', type: 'longBall' },
  { id: 'ball-keeping', name: 'Ball Keeping', type: 'ballKeeping' },
];

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
    .map((id) => trainings.find((training) => training.id === id))
    .filter((training): training is TrainingDefinition => Boolean(training));

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
    result: 'success' | 'average' | 'fail';
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
        }

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

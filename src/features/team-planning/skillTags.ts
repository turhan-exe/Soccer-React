import type { Player } from '@/types';

export type SkillTag =
  | 'finishing'
  | 'aerial'
  | 'holdUp'
  | 'offBall'
  | 'linkPlay'
  | 'pace'
  | 'dribbling'
  | 'crossing'
  | 'workRate'
  | 'support'
  | 'vision'
  | 'passing'
  | 'longShots'
  | 'boxToBox'
  | 'ballWinning'
  | 'pressResist'
  | 'shortPassing'
  | 'shielding'
  | 'distribution'
  | 'sweeper'
  | 'tackling'
  | 'positioning'
  | 'shotStopping';

export type SkillTagMap = Record<SkillTag, number>;

type AttributeKey = keyof Player['attributes'];

type TagWeights = Partial<Record<AttributeKey, number>>;

const SKILL_TAG_WEIGHTS: Record<SkillTag, TagWeights> = {
  finishing: { shooting: 0.5, shootPower: 0.3, positioning: 0.2 },
  aerial: { jump: 0.6, strength: 0.4 },
  holdUp: { strength: 0.4, ballControl: 0.3, passing: 0.3 },
  offBall: { acceleration: 0.3, agility: 0.3, positioning: 0.4 },
  linkPlay: { passing: 0.5, ballControl: 0.3, agility: 0.2 },
  pace: { acceleration: 0.5, topSpeed: 0.5 },
  dribbling: { dribbleSpeed: 0.5, ballControl: 0.3, agility: 0.2 },
  crossing: { longBall: 0.6, passing: 0.4 },
  workRate: { strength: 0.25, acceleration: 0.25, reaction: 0.25, agility: 0.25 },
  support: { passing: 0.4, ballControl: 0.3, agility: 0.3 },
  vision: { passing: 0.6, ballControl: 0.4 },
  passing: { passing: 0.7, longBall: 0.3 },
  longShots: { shootPower: 0.6, shooting: 0.4 },
  boxToBox: { topSpeed: 0.25, acceleration: 0.25, strength: 0.25, tackling: 0.25 },
  ballWinning: { tackling: 0.6, strength: 0.2, reaction: 0.2 },
  pressResist: { ballKeeping: 0.4, agility: 0.3, strength: 0.3 },
  shortPassing: { passing: 0.6, ballControl: 0.4 },
  shielding: { strength: 0.5, ballKeeping: 0.5 },
  distribution: { passing: 0.5, longBall: 0.3, ballControl: 0.2 },
  sweeper: { acceleration: 0.4, topSpeed: 0.3, reaction: 0.3 },
  tackling: { tackling: 0.7, positioning: 0.3 },
  positioning: { positioning: 0.6, reaction: 0.4 },
  shotStopping: { reaction: 0.5, positioning: 0.3, ballKeeping: 0.2 },
};

const clampSkillScore = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
};

const computeWeightedScore = (player: Player, weights: TagWeights): number => {
  let totalWeight = 0;
  let totalValue = 0;
  Object.entries(weights).forEach(([key, weight]) => {
    const attrKey = key as AttributeKey;
    const attributeValue = player.attributes[attrKey];
    const normalizedWeight = Number(weight) || 0;
    if (!Number.isFinite(attributeValue) || normalizedWeight <= 0) {
      return;
    }
    totalWeight += normalizedWeight;
    totalValue += attributeValue * normalizedWeight;
  });
  if (totalWeight === 0) {
    return 0;
  }
  return clampSkillScore(totalValue / totalWeight);
};

export const buildSkillTags = (player: Player): SkillTagMap => {
  const entries = Object.entries(SKILL_TAG_WEIGHTS).map(([tag, weights]) => {
    const key = tag as SkillTag;
    return [key, computeWeightedScore(player, weights)];
  });
  return entries.reduce<SkillTagMap>((acc, [tag, value]) => {
    acc[tag] = value;
    return acc;
  }, {} as SkillTagMap);
};

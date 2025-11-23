import type { Player } from '@/types';
import { clampPerformanceGauge } from '@/components/ui/performance-gauge';
import { normalizeRatingTo100 } from '@/lib/player';

export type SalaryNegotiationProfile = {
  baseSalary: number;
  demand: number;
  floor: number;
  ceiling: number;
  managerSuggested: number;
  narrative: string;
};

export const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
};

export const formatSalary = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0 ₺';
  }
  return `${Math.round(value).toLocaleString('tr-TR')} ₺`;
};

type NegotiationOptions = {
  gaugeFallback?: number;
};

export const buildSalaryNegotiationProfile = (
  player: Player,
  options?: NegotiationOptions,
): SalaryNegotiationProfile => {
  const fallbackGauge = options?.gaugeFallback ?? 0.75;
  const baseSalary = clampNumber(
    Math.round(player.contract?.salary ?? 1800),
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const normalizedMotivation = clampPerformanceGauge(player.motivation, fallbackGauge);
  const overallScore = normalizeRatingTo100(player.overall);
  const potentialScore = normalizeRatingTo100(player.potential);
  const overallFactor = (overallScore / 100) * 0.35;
  const potentialGap = Math.max(0, (potentialScore - overallScore) / 100);
  const potentialFactor = potentialGap * 0.25;
  const motivationFactor = (normalizedMotivation - 0.5) * 0.18;
  const roleFactor =
    player.squadRole === 'starting' ? 0.12 : player.squadRole === 'bench' ? 0.06 : 0.02;
  const ageFactor = player.age > 27 ? -(player.age - 27) * 0.01 : 0;
  const multiplier = 1 + overallFactor + potentialFactor + motivationFactor + roleFactor + ageFactor;
  const demand = Math.round(baseSalary * Math.max(1, multiplier));
  const flexibility = clampNumber(0.25 - motivationFactor * 0.2, 0.08, 0.3);
  const floor = Math.max(baseSalary === 0 ? 0 : Math.round(baseSalary * 0.4), 0);
  const ceilingBase = Math.max(demand, baseSalary);
  const ceiling = Math.round(ceilingBase * 5);
  const managerSuggested = clampNumber(
    Math.round(baseSalary * 0.45 + demand * 0.55),
    floor,
    ceiling,
  );
  const formatImpact = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
  const impactPieces = [
    `Genel ${formatImpact(overallFactor)}`,
    `Potansiyel farkı ${formatImpact(potentialFactor)}`,
    `Motivasyon ${formatImpact(motivationFactor)}`,
    `Rol bonusu ${formatImpact(roleFactor)}`,
  ];
  if (ageFactor !== 0) {
    impactPieces.push(`Yaş ${formatImpact(ageFactor)}`);
  }
  const narrative = `Formülde ${impactPieces.join(', ')} etkisi kullanıldı.`;
  return { baseSalary, demand, floor, ceiling, managerSuggested, narrative };
};

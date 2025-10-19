import type { KitType } from '@/types';

export type KitConfig = {
  label: string;
  description: string;
  diamondCost: number;
  adReward: number;
  conditionDelta: number;
  motivationDelta: number;
  healsInjury: boolean;
};

export const KIT_CONFIG: Record<KitType, KitConfig> = {
  energy: {
    label: 'Enerji Kiti',
    description: 'Seçilen oyuncunun kondisyonunu hızla yeniler ve hafif moral desteği sağlar.',
    diamondCost: 55,
    adReward: 1,
    conditionDelta: 0.2,
    motivationDelta: 0.05,
    healsInjury: false,
  },
  morale: {
    label: 'Moral Kiti',
    description: 'Oyuncunun moralini yükseltir, kondisyonuna küçük bir takviye verir.',
    diamondCost: 50,
    adReward: 1,
    conditionDelta: 0.05,
    motivationDelta: 0.2,
    healsInjury: false,
  },
  health: {
    label: 'Sağlık Kiti',
    description: 'Sakatlıkları tedavi eder, kondisyon ve moral değerlerini dengeli şekilde artırır.',
    diamondCost: 95,
    adReward: 1,
    conditionDelta: 0.15,
    motivationDelta: 0.1,
    healsInjury: true,
  },
};

export const formatKitEffect = (type: KitType): string => {
  const config = KIT_CONFIG[type];
  const conditionPct = Math.round(config.conditionDelta * 100);
  const motivationPct = Math.round(config.motivationDelta * 100);
  const boosts = [
    conditionPct ? `+%${conditionPct} kondisyon` : null,
    motivationPct ? `+%${motivationPct} motivasyon` : null,
    config.healsInjury ? 'Sakatlığı tamamen iyileştirir' : null,
  ].filter(Boolean);

  return boosts.length > 0 ? boosts.join(' • ') : '';
};

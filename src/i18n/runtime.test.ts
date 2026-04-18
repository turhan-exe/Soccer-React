import { afterEach, describe, expect, it } from 'vitest';

import { getYouthDevelopmentLabel } from '@/features/youth/youthPlayerPresentation';
import { getPositionLabel, getPositionShortLabel } from '@/lib/positionLabels';
import { getTrainingAttributeLabel } from '@/lib/trainingLabels';
import { getTrainingResultLabel } from '@/lib/trainingResults';

import { DEFAULT_LANGUAGE, setCurrentLanguage, translate } from './runtime';

describe('i18n runtime helpers', () => {
  afterEach(() => {
    setCurrentLanguage(DEFAULT_LANGUAGE);
  });

  it('falls back to Turkish when the active locale misses a key', () => {
    setCurrentLanguage('en');

    expect(translate('common.nonexistent.key')).toBe('common.nonexistent.key');
    expect(translate('common.teamFallback')).toBe('My Team');
  });

  it('resolves shared football labels in Turkish', () => {
    setCurrentLanguage('tr');

    expect(getPositionLabel('GK')).toBe('Kaleci');
    expect(getPositionShortLabel('RB')).toBe('SGB');
    expect(getTrainingAttributeLabel('strength')).toBe('Guc');
    expect(getTrainingResultLabel('high')).toBe('Basarili Gelisim');
    expect(getTrainingResultLabel('average')).toBe('Orta Gelisim');
    expect(getYouthDevelopmentLabel(35)).toBe('Cok Yuksek Potansiyel');
  });

  it('resolves shared football labels in English', () => {
    setCurrentLanguage('en');

    expect(getPositionLabel('GK')).toBe('Goalkeeper');
    expect(getPositionShortLabel('RB')).toBe('RB');
    expect(getTrainingAttributeLabel('strength')).toBe('Strength');
    expect(getTrainingResultLabel('high')).toBe('Successful Growth');
    expect(getTrainingResultLabel('average')).toBe('Medium Growth');
    expect(getYouthDevelopmentLabel(12)).toBe('Room to Grow');
  });
});

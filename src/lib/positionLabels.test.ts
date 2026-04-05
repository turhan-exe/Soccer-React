import { describe, expect, it } from 'vitest';

import {
  canonicalizePosition,
  getPositionLabel,
  getPositionSearchTokens,
  getPositionShortLabel,
} from './positionLabels';

describe('positionLabels', () => {
  it('canonicalizes supported aliases', () => {
    expect(canonicalizePosition('CB')).toBe('CB');
    expect(canonicalizePosition('STP')).toBe('CB');
    expect(canonicalizePosition('DEF')).toBe('CB');
    expect(canonicalizePosition('MID')).toBe('CM');
    expect(canonicalizePosition('FWD')).toBe('ST');
    expect(canonicalizePosition('CDM')).toBe('CM');
    expect(canonicalizePosition('RWB')).toBe('RB');
    expect(canonicalizePosition('LWB')).toBe('LB');
  });

  it('returns Turkish full and short labels', () => {
    expect(getPositionLabel('CB')).toBe('Stoper');
    expect(getPositionLabel('FWD')).toBe('Santrafor');
    expect(getPositionShortLabel('CB')).toBe('STP');
    expect(getPositionShortLabel('RWB')).toBe('SĞB');
    expect(getPositionShortLabel('LWB')).toBe('SLB');
  });

  it('falls back to the raw value for unknown positions', () => {
    expect(canonicalizePosition('XYZ')).toBeNull();
    expect(getPositionLabel('XYZ')).toBe('XYZ');
    expect(getPositionShortLabel('XYZ')).toBe('XYZ');
  });

  it('provides search tokens for raw, short and full Turkish labels', () => {
    const tokens = getPositionSearchTokens('CB');

    expect(tokens).toEqual(expect.arrayContaining(['cb', 'stp', 'stoper']));

    const matches = (query: string) => tokens.some(token => token.includes(query));
    expect(matches('cb')).toBe(true);
    expect(matches('stp')).toBe(true);
    expect(matches('stoper')).toBe(true);
  });
});

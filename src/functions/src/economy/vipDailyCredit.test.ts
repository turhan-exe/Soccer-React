import { describe, expect, it } from 'vitest';
import {
  getVipDailyCreditDateKey,
  getNextVipDailyCreditDateKey,
  isVipStateActive,
} from './vipDailyCredit';

describe('vip daily credit helpers', () => {
  it('accepts active vip before expiry', () => {
    expect(
      isVipStateActive(
        {
          isActive: true,
          expiresAt: '2026-03-28T10:00:00.000Z',
        },
        Date.parse('2026-03-27T10:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('accepts a future expiry even when the legacy active flag is missing or false', () => {
    expect(
      isVipStateActive(
        {
          expiresAt: '2026-03-28T10:00:00.000Z',
        },
        Date.parse('2026-03-27T10:00:00.000Z'),
      ),
    ).toBe(true);

    expect(
      isVipStateActive(
        {
          isActive: false,
          expiresAt: '2026-03-28T10:00:00.000Z',
        },
        Date.parse('2026-03-27T10:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('rejects expired or invalid vip expiry values', () => {
    expect(
      isVipStateActive(
        {
          isActive: true,
          expiresAt: '2026-03-27T09:59:59.000Z',
        },
        Date.parse('2026-03-27T10:00:00.000Z'),
      ),
    ).toBe(false);

    expect(
      isVipStateActive(
        {
          isActive: true,
          expiresAt: 'not-a-date',
        },
        Date.parse('2026-03-27T10:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('formats the Istanbul claim day key around midnight correctly', () => {
    expect(getVipDailyCreditDateKey(new Date('2026-03-27T20:59:59.000Z'))).toBe('2026-03-27');
    expect(getVipDailyCreditDateKey(new Date('2026-03-27T21:00:00.000Z'))).toBe('2026-03-28');
  });

  it('advances the next claim key to the next Istanbul day', () => {
    expect(getNextVipDailyCreditDateKey(new Date('2026-03-27T10:15:00.000Z'))).toBe('2026-03-28');
  });
});

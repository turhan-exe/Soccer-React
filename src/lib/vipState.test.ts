import { describe, expect, it, vi } from 'vitest';

import { computeVipActive, resolveVipActive } from '@/lib/vipState';

describe('vipState', () => {
  it('keeps vip inactive when the state is not active', () => {
    expect(computeVipActive({ isActive: false, expiresAt: null })).toBe(false);
  });

  it('treats active vip without an expiry as active', () => {
    expect(computeVipActive({ isActive: true, expiresAt: null })).toBe(true);
  });

  it('treats expired vip as inactive', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T12:00:00.000Z'));

    expect(computeVipActive({ isActive: true, expiresAt: '2026-04-14T11:59:59.000Z' })).toBe(false);

    vi.useRealTimers();
  });

  it('suppresses vip activation until hydration finishes', () => {
    expect(resolveVipActive({ isActive: true, expiresAt: null }, false)).toBe(false);
    expect(resolveVipActive({ isActive: true, expiresAt: null }, true)).toBe(true);
  });
});

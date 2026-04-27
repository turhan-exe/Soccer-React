import { describe, expect, it } from 'vitest';
import {
  MAX_SYSTEM_MARKET_TOP_UP_PER_RUN,
  TRANSFER_LISTING_TTL_DAYS,
  getTransferListingExpiresAtIso,
  isTransferListingExpired,
  resolveTransferListingExpiresAtMs,
  TRANSFER_MARKET_TARGET_ACTIVE_LISTINGS,
  buildSystemMarketPlayer,
  resolvePurchasedPlayerId,
  resolveTransferMarketTopUpAmount,
} from './market';

describe('transfer market top-up helpers', () => {
  it('does not request new players when the market already has the target count', () => {
    expect(resolveTransferMarketTopUpAmount(TRANSFER_MARKET_TARGET_ACTIVE_LISTINGS)).toBe(0);
    expect(resolveTransferMarketTopUpAmount(TRANSFER_MARKET_TARGET_ACTIVE_LISTINGS + 25)).toBe(0);
  });

  it('requests the exact deficit up to the per-run limit', () => {
    expect(resolveTransferMarketTopUpAmount(73)).toBe(27);
    expect(resolveTransferMarketTopUpAmount(0, 250, MAX_SYSTEM_MARKET_TOP_UP_PER_RUN)).toBe(
      MAX_SYSTEM_MARKET_TOP_UP_PER_RUN,
    );
  });

  it('generates a valid balanced system market player', () => {
    const player = buildSystemMarketPlayer('listing-test', 3);

    expect(player.id).toMatch(/^market-listing-test-3$/);
    expect(player.name).toBeTruthy();
    expect(player.position).toBeTruthy();
    expect(Array.isArray(player.roles)).toBe(true);
    expect(Array.isArray(player.roles) ? player.roles.length : 0).toBeGreaterThan(0);
    expect(typeof player.overall).toBe('number');
    expect(player.overall).toBeGreaterThanOrEqual(0.45);
    expect(player.overall).toBeLessThanOrEqual(0.82);
    expect(player.potential).toBeGreaterThanOrEqual(player.overall as number);
    expect(player.age).toBeGreaterThanOrEqual(18);
    expect(player.age).toBeLessThanOrEqual(34);
    expect(player.health).toBe(1);
    expect(player.contract?.status).toBe('active');
    expect(player.market?.active).toBe(true);
    expect(player.market?.autoListReason).toBe('market_top_up');
  });
});

describe('transfer listing expiry helpers', () => {
  it('sets listing expiry to two weeks after creation', () => {
    const createdAtMs = Date.parse('2026-04-23T00:00:00.000Z');

    expect(TRANSFER_LISTING_TTL_DAYS).toBe(14);
    expect(getTransferListingExpiresAtIso(createdAtMs)).toBe('2026-05-07T00:00:00.000Z');
  });

  it('prefers explicit expiresAt and falls back to createdAt plus ttl', () => {
    const createdAtMs = Date.parse('2026-04-23T00:00:00.000Z');

    expect(resolveTransferListingExpiresAtMs({ expiresAt: '2026-05-01T00:00:00.000Z' })).toBe(
      Date.parse('2026-05-01T00:00:00.000Z'),
    );
    expect(resolveTransferListingExpiresAtMs({ createdAt: createdAtMs })).toBe(
      Date.parse('2026-05-07T00:00:00.000Z'),
    );
  });

  it('detects expired listings only after the two week window', () => {
    const listing = { createdAt: Date.parse('2026-04-23T00:00:00.000Z') };

    expect(isTransferListingExpired(listing, Date.parse('2026-05-06T23:59:59.000Z'))).toBe(false);
    expect(isTransferListingExpired(listing, Date.parse('2026-05-07T00:00:00.000Z'))).toBe(true);
  });
});

describe('transfer purchase player id resolution', () => {
  it('keeps the seller player id when the buyer does not have that id', () => {
    expect(resolvePurchasedPlayerId('17', 'listing-abc', [{ id: '1' }, { id: '2' }])).toBe('17');
  });

  it('creates a non-colliding id when both teams have the same local player id', () => {
    expect(resolvePurchasedPlayerId('7', 'listing-abc123', [{ id: '7' }])).toBe(
      '7-market-listing-abc1',
    );
  });

  it('increments the generated id if a previous transfer already used it', () => {
    expect(
      resolvePurchasedPlayerId('7', 'listing-abc123', [
        { id: '7' },
        { id: '7-market-listing-abc1' },
      ]),
    ).toBe('7-market-listing-abc1-2');
  });
});

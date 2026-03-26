import { describe, expect, it } from 'vitest';
import type { SponsorCatalogConfig } from './sponsorCatalog';
import {
  assertSponsorActivationAllowed,
  buildSponsorActivationMutations,
} from './sponsorActivation';

const createSponsorConfig = (
  overrides: Partial<SponsorCatalogConfig> = {},
): SponsorCatalogConfig => ({
  sponsorId: 'cococolo',
  catalogId: 'cococolo',
  sponsorName: 'CocoColo',
  type: 'free',
  reward: {
    amount: 10_000,
    cycle: 'daily',
  },
  price: null,
  storeProductId: '',
  ...overrides,
});

describe('sponsor activation helper', () => {
  it('accepts free sponsor activation on free path', () => {
    expect(() => assertSponsorActivationAllowed('free', createSponsorConfig())).not.toThrow();
  });

  it('rejects premium sponsor activation on free path', () => {
    expect(() =>
      assertSponsorActivationAllowed(
        'free',
        createSponsorConfig({
          sponsorId: 'pepsi',
          catalogId: 'pepsi',
          sponsorName: 'Pepsi',
          type: 'premium',
          price: 52.99,
          storeProductId: 'sponsor_pepsi',
        }),
      ),
    ).toThrow(/premium satin alma gerektiriyor/i);
  });

  it('deactivates previous sponsor when a new sponsor is selected', () => {
    const mutations = buildSponsorActivationMutations(
      ['legacy-free', 'cococolo'],
      createSponsorConfig(),
      'server-ts',
    );

    expect(mutations).toEqual([
      {
        sponsorId: 'legacy-free',
        payload: {
          active: false,
        },
      },
      {
        sponsorId: 'cococolo',
        payload: {
          id: 'cococolo',
          catalogId: 'cococolo',
          name: 'CocoColo',
          type: 'free',
          reward: {
            amount: 10_000,
            cycle: 'daily',
          },
          price: null,
          storeProductId: '',
          active: true,
          activatedAt: 'server-ts',
          lastPayoutAt: null,
          nextPayoutAt: null,
        },
      },
    ]);
  });
});

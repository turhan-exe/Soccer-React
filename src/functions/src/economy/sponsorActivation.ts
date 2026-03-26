import * as functions from 'firebase-functions/v1';
import type { SponsorCatalogConfig } from './sponsorCatalog.js';

export type SponsorActivationPath = 'free' | 'premium';

export type SponsorActivationMutation = {
  sponsorId: string;
  payload: Record<string, unknown>;
};

export const assertSponsorActivationAllowed = (
  path: SponsorActivationPath,
  sponsorConfig: SponsorCatalogConfig,
): void => {
  if (path === 'free' && sponsorConfig.type !== 'free') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Secilen sponsor premium satin alma gerektiriyor.',
    );
  }

  if (path === 'premium' && sponsorConfig.type !== 'premium') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Secilen sponsor premium satin alma gerektirmiyor.',
    );
  }
};

export const buildSponsorActivationMutations = (
  existingSponsorIds: string[],
  sponsorConfig: SponsorCatalogConfig,
  activatedAtValue: unknown,
): SponsorActivationMutation[] => {
  const knownSponsorIds = [...new Set(existingSponsorIds)];
  const selectedSponsorId = sponsorConfig.sponsorId;
  const selectedPayload = {
    id: selectedSponsorId,
    catalogId: sponsorConfig.catalogId,
    name: sponsorConfig.sponsorName,
    type: sponsorConfig.type,
    reward: sponsorConfig.reward,
    price: sponsorConfig.price,
    storeProductId: sponsorConfig.storeProductId,
    active: true,
    activatedAt: activatedAtValue,
    lastPayoutAt: null,
    nextPayoutAt: null,
  };

  const mutations = knownSponsorIds.map((existingSponsorId) => ({
    sponsorId: existingSponsorId,
    payload: existingSponsorId === selectedSponsorId ? selectedPayload : { active: false },
  }));

  if (!knownSponsorIds.includes(selectedSponsorId)) {
    mutations.push({
      sponsorId: selectedSponsorId,
      payload: selectedPayload,
    });
  }

  return mutations;
};

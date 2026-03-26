import * as functions from 'firebase-functions/v1';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

export type SponsorRewardCycle = 'daily' | 'weekly';

export type SponsorCatalogConfig = {
  sponsorId: string;
  catalogId: string;
  sponsorName: string;
  type: 'free' | 'premium';
  reward: {
    amount: number;
    cycle: SponsorRewardCycle;
  };
  price: number | null;
  storeProductId: string;
};

export const normalizeSponsorString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const sanitizeSponsorKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

export const buildSponsorProductId = (catalogId: string, explicitProductId?: string | null): string => {
  const normalizedExplicit = normalizeSponsorString(explicitProductId);
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const key = sanitizeSponsorKey(catalogId);
  return key ? `sponsor_${key}` : '';
};

const resolveSponsorReward = (
  rawReward: unknown,
  rawCycle: unknown,
): { amount: number; cycle: SponsorRewardCycle } => {
  const resolveCycle = (): SponsorRewardCycle => {
    if (rawCycle === 'daily' || rawCycle === 'weekly') {
      return rawCycle;
    }
    if (typeof rawCycle === 'number') {
      return rawCycle <= 1 ? 'daily' : 'weekly';
    }
    return 'weekly';
  };

  if (typeof rawReward === 'number') {
    return { amount: Number(rawReward), cycle: resolveCycle() };
  }

  if (typeof rawReward === 'object' && rawReward !== null) {
    const rewardObject = rawReward as Record<string, unknown>;
    return {
      amount: Number(rewardObject.amount ?? 0),
      cycle:
        rewardObject.cycle === 'daily' || rewardObject.cycle === 'weekly'
          ? rewardObject.cycle
          : resolveCycle(),
    };
  }

  return { amount: Number(rawReward ?? 0), cycle: resolveCycle() };
};

export const getSponsorCatalogConfig = async (sponsorId: string): Promise<SponsorCatalogConfig> => {
  const sponsorRef = db.collection('sponsorship_catalog').doc(sponsorId);
  const sponsorSnap = await sponsorRef.get();

  if (!sponsorSnap.exists) {
    throw new functions.https.HttpsError('invalid-argument', 'Sponsor katalogda bulunamadi.');
  }

  const raw = sponsorSnap.data() as Record<string, unknown>;
  const price = raw.price === undefined ? null : Number(raw.price);
  const type =
    raw.type === 'premium' || raw.type === 'free'
      ? raw.type
      : typeof price === 'number' && price > 0
        ? 'premium'
        : 'free';

  const catalogId = normalizeSponsorString(raw.catalogId) || sponsorId;
  const storeProductId = buildSponsorProductId(
    catalogId,
    normalizeSponsorString(raw.storeProductId) || null,
  );

  return {
    sponsorId,
    catalogId,
    sponsorName: normalizeSponsorString(raw.name) || sponsorId,
    type,
    reward: resolveSponsorReward(raw.reward, raw.cycle),
    price: Number.isFinite(price) ? Number(price) : null,
    storeProductId,
  };
};

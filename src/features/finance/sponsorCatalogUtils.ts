import type { QuerySnapshot, DocumentData } from 'firebase/firestore';
import type { SponsorCatalogEntry, SponsorReward } from '@/services/finance';

const normalizeStoreProductId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const sanitizeSponsorKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

export const buildSponsorStoreProductId = (
  entry: Pick<SponsorCatalogEntry, 'id' | 'catalogId' | 'storeProductId' | 'type'>,
): string => {
  if (entry.type !== 'premium') {
    return '';
  }

  const explicit = normalizeStoreProductId(entry.storeProductId);
  if (explicit) {
    return explicit;
  }

  const key = sanitizeSponsorKey(entry.catalogId || entry.id);
  return key ? `sponsor_${key}` : '';
};

export const mapSponsorCatalogSnapshot = (
  snapshot: QuerySnapshot<DocumentData>,
): SponsorCatalogEntry[] =>
  snapshot.docs.map((docSnap) => {
    const raw = docSnap.data() as Record<string, unknown>;
    const rawReward = raw.reward;
    const rawCycle = raw.cycle;
    const resolveCycle = (): SponsorReward['cycle'] => {
      if (rawCycle === 'daily' || rawCycle === 'weekly') {
        return rawCycle;
      }
      if (typeof rawCycle === 'number') {
        return rawCycle <= 1 ? 'daily' : 'weekly';
      }
      return 'weekly';
    };

    const reward: SponsorReward =
      typeof rawReward === 'number'
        ? { amount: Number(rawReward), cycle: resolveCycle() }
        : typeof rawReward === 'object' && rawReward !== null
          ? {
              amount: Number((rawReward as Record<string, unknown>).amount ?? 0),
              cycle:
                ((rawReward as Record<string, unknown>).cycle as SponsorReward['cycle']) ??
                resolveCycle(),
            }
          : { amount: Number(rawReward ?? 0), cycle: resolveCycle() };

    const normalizedType =
      raw.type === 'premium' || raw.type === 'free'
        ? raw.type
        : typeof raw.price === 'number' && raw.price > 0
          ? 'premium'
          : 'free';

    const entry: SponsorCatalogEntry = {
      id: docSnap.id,
      catalogId: typeof raw.catalogId === 'string' ? raw.catalogId : docSnap.id,
      name: String(raw.name ?? 'Adsiz Sponsor'),
      type: normalizedType,
      reward,
      price: raw.price === undefined ? undefined : Number(raw.price),
      storeProductId: normalizeStoreProductId(raw.storeProductId),
    };

    return {
      ...entry,
      storeProductId: buildSponsorStoreProductId(entry) || entry.storeProductId || null,
    };
  });

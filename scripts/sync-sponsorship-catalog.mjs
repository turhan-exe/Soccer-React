import fs from 'node:fs/promises';
import path from 'node:path';
import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const DEFAULT_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'osm-react';
const DEFAULT_SEED_PATH = path.resolve(process.cwd(), 'infra', 'sponsorship_catalog.seed.json');
const PREMIUM_MIN_MONTHLY_MULTIPLIER = 2;

const parseArgs = (argv) => {
  const options = {
    projectId: DEFAULT_PROJECT_ID,
    seedPath: DEFAULT_SEED_PATH,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (value === '--project' && argv[index + 1]) {
      options.projectId = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--seed' && argv[index + 1]) {
      options.seedPath = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  return options;
};

const monthlyRewardValue = (entry) =>
  entry.reward.cycle === 'daily' ? entry.reward.amount * 30 : Math.round((entry.reward.amount * 30) / 7);

const normalizeSeedEntry = (raw, index) => {
  const docId = typeof raw?.docId === 'string' ? raw.docId.trim() : '';
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  const type = raw?.type === 'free' || raw?.type === 'premium' ? raw.type : null;
  const rewardAmount = Number(raw?.reward?.amount);
  const rewardCycle = raw?.reward?.cycle === 'daily' || raw?.reward?.cycle === 'weekly'
    ? raw.reward.cycle
    : null;
  const price = raw?.price == null ? null : Number(raw.price);

  if (!docId) {
    throw new Error(`Seed entry #${index + 1} is missing docId.`);
  }
  if (!name) {
    throw new Error(`Seed entry ${docId} is missing name.`);
  }
  if (!type) {
    throw new Error(`Seed entry ${docId} has invalid type.`);
  }
  if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
    throw new Error(`Seed entry ${docId} has invalid reward.amount.`);
  }
  if (!rewardCycle) {
    throw new Error(`Seed entry ${docId} has invalid reward.cycle.`);
  }
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    throw new Error(`Seed entry ${docId} has invalid price.`);
  }

  return {
    docId,
    name,
    type,
    reward: {
      amount: Math.round(rewardAmount),
      cycle: rewardCycle,
    },
    price: price == null ? null : Math.round(price),
  };
};

const validateCatalogBalance = (entries) => {
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.docId)) {
      throw new Error(`Duplicate sponsor docId found: ${entry.docId}`);
    }
    ids.add(entry.docId);
  }

  const freeEntries = entries.filter((entry) => entry.type === 'free');
  const premiumEntries = entries.filter((entry) => entry.type === 'premium');

  if (freeEntries.length === 0) {
    throw new Error('Catalog must contain at least one free sponsor.');
  }
  if (premiumEntries.length === 0) {
    throw new Error('Catalog must contain at least one premium sponsor.');
  }

  for (const entry of freeEntries) {
    if ((entry.price ?? 0) !== 0) {
      throw new Error(`Free sponsor ${entry.docId} must have price 0.`);
    }
  }

  const maxFreeMonthly = Math.max(...freeEntries.map(monthlyRewardValue));
  for (const entry of premiumEntries) {
    const monthlyValue = monthlyRewardValue(entry);
    if (monthlyValue <= maxFreeMonthly) {
      throw new Error(
        `Premium sponsor ${entry.docId} monthly value ${monthlyValue} must exceed free baseline ${maxFreeMonthly}.`,
      );
    }
    if (monthlyValue < Math.round(maxFreeMonthly * PREMIUM_MIN_MONTHLY_MULTIPLIER)) {
      throw new Error(
        `Premium sponsor ${entry.docId} monthly value ${monthlyValue} must be at least ${PREMIUM_MIN_MONTHLY_MULTIPLIER}x free baseline ${maxFreeMonthly}.`,
      );
    }
  }
}

const loadSeed = async (seedPath) => {
  const raw = await fs.readFile(seedPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Sponsor catalog seed must be an array.');
  }
  const entries = parsed.map(normalizeSeedEntry);
  validateCatalogBalance(entries);
  return entries;
};

const ensureApp = (projectId) => {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  return admin.app();
};

const syncCatalog = async (db, entries) => {
  let sponsorshipDocsUpdated = 0;

  for (const entry of entries) {
    const catalogRef = db.collection('sponsorship_catalog').doc(entry.docId);
    await catalogRef.set(
      {
        name: entry.name,
        type: entry.type,
        reward: entry.reward.amount,
        cycle: entry.reward.cycle,
        price: entry.price ?? 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  const userSnapshot = await db.collection('users').get();
  for (const userDoc of userSnapshot.docs) {
    const batch = db.batch();
    let batchHasWrites = false;

    for (const entry of entries) {
      const sponsorRef = userDoc.ref.collection('sponsorships').doc(entry.docId);
      const sponsorSnap = await sponsorRef.get();
      if (!sponsorSnap.exists) {
        continue;
      }

      batch.set(
        sponsorRef,
        {
          id: entry.docId,
          name: entry.name,
          type: entry.type,
          reward: entry.reward,
          price: entry.price ?? 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      batchHasWrites = true;
      sponsorshipDocsUpdated += 1;
    }

    if (batchHasWrites) {
      await batch.commit();
    }
  }

  return { sponsorshipDocsUpdated, usersScanned: userSnapshot.size };
};

const printSummary = (entries, options, extra = {}) => {
  const catalog = entries.map((entry) => ({
    docId: entry.docId,
    name: entry.name,
    type: entry.type,
    cycle: entry.reward.cycle,
    reward: entry.reward.amount,
    monthlyValue: monthlyRewardValue(entry),
    price: entry.price ?? 0,
  }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: options.dryRun,
        projectId: options.projectId,
        seedPath: options.seedPath,
        catalog,
        ...extra,
      },
      null,
      2,
    ),
  );
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const entries = await loadSeed(options.seedPath);

  if (options.dryRun) {
    printSummary(entries, options);
    return;
  }

  ensureApp(options.projectId);
  const db = admin.firestore();
  const result = await syncCatalog(db, entries);
  printSummary(entries, options, result);
};

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});

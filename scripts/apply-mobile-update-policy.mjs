import fs from 'node:fs/promises';
import path from 'node:path';
import admin from 'firebase-admin';

const ROOT_DIR = process.cwd();
const APP_VERSION_PATH = path.resolve(ROOT_DIR, 'app.version.json');
const REPORT_DIR = path.resolve(ROOT_DIR, 'tmp');
const LOG_PATH = path.resolve(ROOT_DIR, 'scripts', 'apply-mobile-update-policy.log');
const DEFAULT_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'osm-react';
const DEFAULT_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.nerbuss.fhsmanager';
const DEFAULT_BLOCK_TITLE = 'Guncelleme gerekli';
const DEFAULT_BLOCK_MESSAGE =
  'Devam etmek icin uygulamanin en son surumunu yukleyin.';

const parseArgs = (argv) => {
  const options = {
    apply: false,
    projectId: DEFAULT_PROJECT_ID,
    serviceAccountPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
    latestVersionCode: null,
    latestVersionName: '',
    minSupportedVersionCode: null,
    gateMode: 'enforce',
    pendingActivateAtMs: null,
    pendingActivateInHours: null,
    pendingLatestVersionCode: null,
    pendingLatestVersionName: '',
    pendingMinSupportedVersionCode: null,
    pendingGateMode: 'enforce',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--apply') {
      options.apply = true;
      continue;
    }
    if (value === '--project' && argv[index + 1]) {
      options.projectId = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--service-account' && argv[index + 1]) {
      options.serviceAccountPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--latest-version-code' && argv[index + 1]) {
      options.latestVersionCode = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if (value === '--latest-version-name' && argv[index + 1]) {
      options.latestVersionName = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--min-supported-version-code' && argv[index + 1]) {
      options.minSupportedVersionCode = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if (value === '--gate-mode' && argv[index + 1]) {
      options.gateMode = argv[index + 1] === 'observe' ? 'observe' : 'enforce';
      index += 1;
      continue;
    }
    if (value === '--pending-activate-at-ms' && argv[index + 1]) {
      options.pendingActivateAtMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if (value === '--pending-activate-in-hours' && argv[index + 1]) {
      options.pendingActivateInHours = Number.parseFloat(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === '--pending-latest-version-code' && argv[index + 1]) {
      options.pendingLatestVersionCode = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if (value === '--pending-latest-version-name' && argv[index + 1]) {
      options.pendingLatestVersionName = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--pending-min-supported-version-code' && argv[index + 1]) {
      options.pendingMinSupportedVersionCode = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if (value === '--pending-gate-mode' && argv[index + 1]) {
      options.pendingGateMode = argv[index + 1] === 'observe' ? 'observe' : 'enforce';
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  return options;
};

const ensureApp = async (options) => {
  if (admin.apps.length) {
    return admin.app();
  }

  if (options.serviceAccountPath) {
    const resolvedPath = path.resolve(ROOT_DIR, options.serviceAccountPath);
    const raw = await fs.readFile(resolvedPath, 'utf8');
    const serviceAccount = JSON.parse(raw);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || options.projectId,
    });
  }

  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: options.projectId,
  });
};

const readRepoAppVersion = async () => {
  const raw = await fs.readFile(APP_VERSION_PATH, 'utf8');
  const parsed = JSON.parse(raw);

  const versionCode = Number.parseInt(String(parsed.versionCode ?? ''), 10);
  const versionName = typeof parsed.versionName === 'string'
    ? parsed.versionName.trim()
    : '';

  if (!Number.isInteger(versionCode) || versionCode <= 0 || !versionName) {
    throw new Error(`Invalid app.version.json content in ${APP_VERSION_PATH}`);
  }

  return {
    versionCode,
    versionName,
  };
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const timestampForFile = () => new Date().toISOString().replace(/[:.]/g, '-');

const appendLog = async (message) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fs.appendFile(LOG_PATH, line, 'utf8');
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const repoVersion = await readRepoAppVersion();
  const latestVersionCode = options.latestVersionCode ?? repoVersion.versionCode;
  const latestVersionName = options.latestVersionName || repoVersion.versionName;
  const minSupportedVersionCode =
    options.minSupportedVersionCode ?? latestVersionCode;
  const pendingActivateAtMs = Number.isFinite(options.pendingActivateAtMs)
    ? Math.trunc(options.pendingActivateAtMs)
    : Number.isFinite(options.pendingActivateInHours)
      ? Date.now() + Math.round(options.pendingActivateInHours * 60 * 60 * 1000)
      : null;
  const pendingLatestVersionCode = options.pendingLatestVersionCode;
  const pendingLatestVersionName = options.pendingLatestVersionName;
  const pendingMinSupportedVersionCode = options.pendingMinSupportedVersionCode;

  if (!Number.isInteger(latestVersionCode) || latestVersionCode <= 0) {
    throw new Error('latestVersionCode must be a positive integer.');
  }
  if (!Number.isInteger(minSupportedVersionCode) || minSupportedVersionCode <= 0) {
    throw new Error('minSupportedVersionCode must be a positive integer.');
  }
  if (!latestVersionName) {
    throw new Error('latestVersionName must be a non-empty string.');
  }
  if (
    pendingActivateAtMs !== null
    || pendingLatestVersionCode !== null
    || pendingMinSupportedVersionCode !== null
    || pendingLatestVersionName
  ) {
    if (!Number.isInteger(pendingActivateAtMs) || pendingActivateAtMs <= Date.now()) {
      throw new Error('pendingActivateAtMs must be a future timestamp.');
    }
    if (!Number.isInteger(pendingLatestVersionCode) || pendingLatestVersionCode <= 0) {
      throw new Error('pendingLatestVersionCode must be a positive integer.');
    }
    if (!Number.isInteger(pendingMinSupportedVersionCode) || pendingMinSupportedVersionCode <= 0) {
      throw new Error('pendingMinSupportedVersionCode must be a positive integer.');
    }
  }

  await ensureApp(options);
  const db = admin.firestore();
  const docRef = db.collection('public_config').doc('mobile_update');
  const snapshot = await docRef.get();
  const currentData = snapshot.exists ? snapshot.data() ?? {} : {};
  const currentAndroid =
    currentData.android && typeof currentData.android === 'object'
      ? currentData.android
      : {};

  const nextAndroid = {
    ...currentAndroid,
    latestVersionCode,
    latestVersionName,
    minSupportedVersionCode,
    forceImmediateUpdate: true,
    gateMode: options.gateMode,
    storeUrl: typeof currentAndroid.storeUrl === 'string' && currentAndroid.storeUrl.trim()
      ? currentAndroid.storeUrl.trim()
      : DEFAULT_STORE_URL,
    blockTitle: typeof currentAndroid.blockTitle === 'string' && currentAndroid.blockTitle.trim()
      ? currentAndroid.blockTitle.trim()
      : DEFAULT_BLOCK_TITLE,
    blockMessage:
      typeof currentAndroid.blockMessage === 'string' && currentAndroid.blockMessage.trim()
        ? currentAndroid.blockMessage.trim()
        : DEFAULT_BLOCK_MESSAGE,
  };

  if (pendingActivateAtMs !== null) {
    nextAndroid.pendingActivation = {
      activateAtMs: pendingActivateAtMs,
      latestVersionCode: Math.max(
        pendingLatestVersionCode,
        pendingMinSupportedVersionCode,
      ),
      latestVersionName:
        pendingLatestVersionName
        || String(Math.max(pendingLatestVersionCode, pendingMinSupportedVersionCode)),
      minSupportedVersionCode: pendingMinSupportedVersionCode,
      gateMode: options.pendingGateMode,
      forceImmediateUpdate: true,
    };
  }

  const payload = {
    ...currentData,
    android: nextAndroid,
  };

  const preview = {
    projectId: admin.app().options.projectId || options.projectId,
    apply: options.apply,
    currentAndroid,
    nextAndroid,
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!options.apply) {
    await appendLog(
      `Dry run mobile update policy preview for ${preview.projectId} -> ${latestVersionName} (${latestVersionCode})`,
    );
    return;
  }

  await ensureDir(REPORT_DIR);
  const backupPath = path.resolve(
    REPORT_DIR,
    `mobile-update-policy-${timestampForFile()}.backup.json`,
  );
  await fs.writeFile(
    backupPath,
    JSON.stringify(
      {
        projectId: preview.projectId,
        backedUpAt: new Date().toISOString(),
        exists: snapshot.exists,
        data: currentData,
      },
      null,
      2,
    ),
    'utf8',
  );

  await docRef.set(payload, { merge: true });
  await appendLog(
    `Applied mobile update policy for ${preview.projectId}: ${latestVersionName} (${latestVersionCode}), min=${minSupportedVersionCode}, gateMode=${options.gateMode}, backup=${backupPath}`,
  );

  console.log(JSON.stringify({ ok: true, backupPath, android: nextAndroid }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import fs from 'node:fs/promises';
import path from 'node:path';
import admin from 'firebase-admin';

const INITIAL_CLUB_BALANCE = 75_000;
const CONTRACT_MIN_YEARS = 2;
const CONTRACT_MAX_YEARS = 4;
const DEFAULT_FORMATION = '4-4-2';
const REPORT_DIR = path.resolve(process.cwd(), 'tmp');
const DEFAULT_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'osm-react';

const FORMATIONS = [
  {
    name: '4-4-2',
    positions: ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'],
  },
];

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'CAM', 'LW', 'RW', 'ST'];

const POSITION_ATTRIBUTES = {
  GK: ['positioning', 'reaction', 'longBall', 'strength', 'jump'],
  CB: ['strength', 'tackling', 'jump', 'positioning', 'reaction'],
  LB: ['acceleration', 'topSpeed', 'tackling', 'passing', 'agility'],
  RB: ['acceleration', 'topSpeed', 'tackling', 'passing', 'agility'],
  CM: ['passing', 'ballControl', 'ballKeeping', 'agility', 'reaction'],
  LM: ['acceleration', 'topSpeed', 'dribbleSpeed', 'passing', 'ballControl'],
  RM: ['acceleration', 'topSpeed', 'dribbleSpeed', 'passing', 'ballControl'],
  CAM: ['passing', 'ballControl', 'shooting', 'agility', 'reaction'],
  LW: ['topSpeed', 'dribbleSpeed', 'shooting', 'ballControl', 'passing'],
  RW: ['topSpeed', 'dribbleSpeed', 'shooting', 'ballControl', 'passing'],
  ST: ['shooting', 'shootPower', 'positioning', 'strength', 'topSpeed'],
};

const POSITION_ROLES = {
  GK: ['GK'],
  CB: ['CB'],
  LB: ['LB', 'LM'],
  RB: ['RB', 'RM'],
  CM: ['CM', 'CAM'],
  LM: ['LM', 'LW'],
  RM: ['RM', 'RW'],
  CAM: ['CAM', 'CM'],
  LW: ['LW', 'LM', 'ST'],
  RW: ['RW', 'RM', 'ST'],
  ST: ['ST', 'CAM'],
};

const FIRST_PREFIXES = [
  'Al', 'Ar', 'Ay', 'Ba', 'Be', 'Bu', 'Ca', 'Ce', 'Da', 'De',
  'El', 'Em', 'Fa', 'Fe', 'Ga', 'Ge', 'Ha', 'He', 'Il', 'Is',
  'Ka', 'Ke', 'Le', 'Ma', 'Me',
];

const LAST_PREFIXES = [
  'Ak', 'Bal', 'Can', 'Dem', 'Er', 'Fer', 'Gul', 'Hak', 'Ilg', 'Kar',
  'Lem', 'Mor', 'Naz', 'Oz', 'Pol', 'Quz', 'Ras', 'Sar', 'Tas', 'Uzg',
  'Var', 'Yen', 'Zor', 'Bar', 'Cel',
];

const SUFFIXES = [
  'a', 'e', 'i', 'o', 'u', 'an', 'en', 'in', 'on', 'un',
  'ar', 'er', 'ir', 'or', 'ur', 'am', 'em', 'im', 'om', 'um',
];

const FIRST_NAMES = FIRST_PREFIXES.flatMap((prefix) => SUFFIXES.map((suffix) => `${prefix}${suffix}`));
const LAST_NAMES = LAST_PREFIXES.flatMap((prefix) => SUFFIXES.map((suffix) => `${prefix}${suffix}`));

const parseArgs = (argv) => {
  const options = {
    apply: false,
    projectId: DEFAULT_PROJECT_ID,
    serviceAccountPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
    targetUids: [],
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
    if (value === '--uid' && argv[index + 1]) {
      options.targetUids.push(argv[index + 1]);
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
    const resolvedPath = path.resolve(process.cwd(), options.serviceAccountPath);
    const raw = await fs.readFile(resolvedPath, 'utf8');
    const serviceAccount = JSON.parse(raw);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: options.projectId,
  });
};

const toSerializable = (value) => {
  if (value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item));
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      return value.toDate().toISOString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    const entries = Object.entries(value)
      .filter(([, itemValue]) => itemValue !== undefined)
      .map(([key, itemValue]) => [key, toSerializable(itemValue)]);
    return Object.fromEntries(entries);
  }
  return value;
};

const hashString = (input) => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seedInput) => {
  let state = hashString(seedInput) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

const randomAttr = (rng) => Number(rng().toFixed(3));
const randomGauge = (rng) => Number((0.6 + rng() * 0.4).toFixed(3));

const getPositionAttributes = (position) => POSITION_ATTRIBUTES[position] ?? POSITION_ATTRIBUTES.CM;
const getRoles = (position) => POSITION_ROLES[position] ?? [position];

const calculateOverall = (position, attributes) => {
  const keys = getPositionAttributes(position);
  const total = keys.reduce((sum, key) => sum + attributes[key], 0);
  return Number((total / keys.length).toFixed(3));
};

const clampSalary = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
};

const roundSalary = (value) => {
  const normalized = clampSalary(value);
  return Math.max(250, Math.round(normalized / 250) * 250);
};

const interpolate = (rating, minRating, maxRating, minSalary, maxSalary) => {
  if (maxRating <= minRating) {
    return minSalary;
  }
  const progress = Math.max(0, Math.min(1, (rating - minRating) / (maxRating - minRating)));
  return minSalary + (maxSalary - minSalary) * progress;
};

const normalizeRatingTo100 = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 2.0) {
    return Math.max(0, Math.min(99, Math.round(value * 100)));
  }
  if (value <= 10.0) {
    return Math.max(0, Math.min(99, Math.round(value * 10)));
  }
  return Math.max(0, Math.min(99, Math.round(value)));
};

const getSalaryForOverall = (overall) => {
  const rating = normalizeRatingTo100(overall);

  if (rating <= 45) {
    return roundSalary(interpolate(rating, 0, 45, 1800, 4000));
  }
  if (rating <= 55) {
    return roundSalary(interpolate(rating, 45, 55, 4000, 6500));
  }
  if (rating <= 65) {
    return roundSalary(interpolate(rating, 55, 65, 6500, 9500));
  }
  if (rating <= 75) {
    return roundSalary(interpolate(rating, 65, 75, 9500, 14500));
  }
  if (rating <= 85) {
    return roundSalary(interpolate(rating, 75, 85, 14500, 22000));
  }
  if (rating <= 95) {
    return roundSalary(interpolate(rating, 85, 95, 22000, 34000));
  }

  return roundSalary(interpolate(rating, 95, 99, 34000, 42000));
};

const addGameYears = (date, years) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + years);
  return result;
};

const createInitialContract = (overall, rng, now) => {
  const years = Math.floor(rng() * (CONTRACT_MAX_YEARS - CONTRACT_MIN_YEARS + 1)) + CONTRACT_MIN_YEARS;
  return {
    expiresAt: addGameYears(now, years).toISOString(),
    status: 'active',
    salary: getSalaryForOverall(overall),
    extensions: 0,
  };
};

const createInitialRenameState = () => ({
  adAvailableAt: new Date(0).toISOString(),
});

const generateRandomName = (rng) => `${pick(FIRST_NAMES, rng)} ${pick(LAST_NAMES, rng)}`;

const generatePlayer = ({ id, forcedPosition, rng, now }) => {
  const position = forcedPosition || pick(POSITIONS, rng);
  const attributes = {
    strength: randomAttr(rng),
    acceleration: randomAttr(rng),
    topSpeed: randomAttr(rng),
    dribbleSpeed: randomAttr(rng),
    jump: randomAttr(rng),
    tackling: randomAttr(rng),
    ballKeeping: randomAttr(rng),
    passing: randomAttr(rng),
    longBall: randomAttr(rng),
    agility: randomAttr(rng),
    shooting: randomAttr(rng),
    shootPower: randomAttr(rng),
    positioning: randomAttr(rng),
    reaction: randomAttr(rng),
    ballControl: randomAttr(rng),
  };

  const overall = calculateOverall(position, attributes);
  const potential = Math.min(1, Number((overall + rng() * (1 - overall)).toFixed(3)));

  return {
    id: String(id),
    name: generateRandomName(rng),
    position,
    roles: getRoles(position),
    overall,
    potential,
    attributes,
    age: Math.floor(rng() * 17) + 18,
    ageUpdatedAt: now.toISOString(),
    height: 180,
    weight: 75,
    health: 1,
    squadRole: 'reserve',
    condition: randomGauge(rng),
    motivation: randomGauge(rng),
    injuryStatus: 'healthy',
    contract: createInitialContract(overall, rng, now),
    rename: createInitialRenameState(),
  };
};

const buildGeneratedRoster = (uid) => {
  const now = new Date();
  const rng = createSeededRandom(uid);
  const players = [];
  const startingPositions = FORMATIONS[0].positions;

  startingPositions.forEach((position, index) => {
    players.push(generatePlayer({ id: index + 1, forcedPosition: position, rng, now }));
  });

  for (let index = startingPositions.length; index < 30; index += 1) {
    players.push(generatePlayer({ id: index + 1, rng, now }));
  }

  players.slice(0, 11).forEach((player) => {
    player.squadRole = 'starting';
  });
  players.slice(11, 22).forEach((player) => {
    player.squadRole = 'bench';
  });
  players.slice(22).forEach((player) => {
    player.squadRole = 'reserve';
  });

  return players;
};

const normalizeClubBalance = (value, fallback = INITIAL_CLUB_BALANCE) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.round(fallback));
  }
  return Math.max(0, Math.round(numeric));
};

const resolveIssue = (teamData) => {
  if (!teamData) {
    return 'team_doc_missing';
  }
  if (!Object.prototype.hasOwnProperty.call(teamData, 'players')) {
    return 'players_field_missing';
  }
  if (!Array.isArray(teamData.players)) {
    return 'players_field_not_array';
  }
  if (teamData.players.length === 0) {
    return 'players_empty';
  }
  return null;
};

const deriveManagerName = (teamData, authUser) => {
  if (typeof teamData?.manager === 'string' && teamData.manager.trim()) {
    return teamData.manager.trim();
  }
  if (typeof authUser?.displayName === 'string' && authUser.displayName.trim()) {
    return authUser.displayName.trim();
  }
  if (typeof authUser?.email === 'string' && authUser.email.includes('@')) {
    return authUser.email.split('@')[0];
  }
  if (typeof teamData?.name === 'string' && teamData.name.trim()) {
    return teamData.name.trim();
  }
  return 'Menajer';
};

const buildPlanPayload = (players, nowIso) => {
  const starters = players.filter((player) => player.squadRole === 'starting').map((player) => player.id);
  const bench = players.filter((player) => player.squadRole === 'bench').map((player) => player.id);
  const reserves = players.filter((player) => player.squadRole === 'reserve').map((player) => player.id);

  return {
    plan: {
      formation: DEFAULT_FORMATION,
      starters,
      bench,
      reserves,
      updatedAt: nowIso,
    },
    lineup: {
      formation: DEFAULT_FORMATION,
      tactics: {},
      starters,
      subs: bench,
      reserves,
      updatedAt: nowIso,
    },
  };
};

const sanitizeFirestoreData = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeFirestoreData(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, itemValue]) => itemValue !== undefined)
      .map(([key, itemValue]) => [key, sanitizeFirestoreData(itemValue)]);
    return Object.fromEntries(entries);
  }
  return value;
};

const buildRepairPatch = ({ uid, teamData, authUser }) => {
  const players = buildGeneratedRoster(uid);
  const nowIso = new Date().toISOString();
  const transferBudget = normalizeClubBalance(
    teamData?.transferBudget,
    Number.isFinite(teamData?.budget) ? teamData.budget : INITIAL_CLUB_BALANCE,
  );
  const budget = normalizeClubBalance(teamData?.budget, transferBudget);
  const teamName =
    typeof teamData?.name === 'string' && teamData.name.trim()
      ? teamData.name.trim()
      : typeof authUser?.displayName === 'string' && authUser.displayName.trim()
        ? authUser.displayName.trim()
        : typeof authUser?.email === 'string' && authUser.email.includes('@')
          ? authUser.email.split('@')[0]
          : `Team ${uid.slice(0, 8)}`;

  return sanitizeFirestoreData({
    id: uid,
    name: teamName,
    manager: deriveManagerName(teamData, authUser),
    ownerUid:
      typeof teamData?.ownerUid === 'string' && teamData.ownerUid.trim() ? teamData.ownerUid.trim() : uid,
    kitHome:
      typeof teamData?.kitHome === 'string' && teamData.kitHome.trim() ? teamData.kitHome.trim() : 'home',
    kitAway:
      typeof teamData?.kitAway === 'string' && teamData.kitAway.trim() ? teamData.kitAway.trim() : 'away',
    budget,
    transferBudget,
    players,
    ...buildPlanPayload(players, nowIso),
  });
};

const loadAuthUsers = async (auth) => {
  const usersByUid = new Map();
  let nextPageToken;

  do {
    const response = await auth.listUsers(1000, nextPageToken);
    response.users.forEach((user) => {
      usersByUid.set(user.uid, {
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        disabled: Boolean(user.disabled),
        creationTime: user.metadata?.creationTime ?? null,
        lastSignInTime: user.metadata?.lastSignInTime ?? null,
      });
    });
    nextPageToken = response.pageToken;
  } while (nextPageToken);

  return usersByUid;
};

const collectTargets = async ({ db, authUsersByUid, targetUids }) => {
  const teamRefs = targetUids.length
    ? await Promise.all(targetUids.map((uid) => db.collection('teams').doc(uid).get()))
    : (await db.collection('teams').get()).docs;

  const docs = targetUids.length ? teamRefs : teamRefs;
  const targets = [];

  docs.forEach((docSnap) => {
    if (!docSnap.exists) {
      return;
    }
    const teamData = docSnap.data() ?? {};
    const issue = resolveIssue(teamData);
    if (!issue) {
      return;
    }
    const authUser = authUsersByUid.get(docSnap.id) ?? null;
    targets.push({
      uid: docSnap.id,
      teamRefPath: docSnap.ref.path,
      issue,
      teamData,
      authUser,
      teamName: typeof teamData.name === 'string' ? teamData.name : null,
    });
  });

  return targets.sort((left, right) => left.uid.localeCompare(right.uid));
};

const writeBackupFile = async (targets) => {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(REPORT_DIR, `repair-missing-team-rosters-${stamp}.backup.json`);
  const payload = targets.map((target) => ({
    uid: target.uid,
    issue: target.issue,
    teamRefPath: target.teamRefPath,
    authUser: target.authUser,
    teamData: toSerializable(target.teamData),
  }));
  await fs.writeFile(backupPath, JSON.stringify(payload, null, 2));
  return backupPath;
};

const applyRepairs = async ({ db, targets }) => {
  const repaired = [];
  const skipped = [];
  const failures = [];

  for (const target of targets) {
    const teamRef = db.collection('teams').doc(target.uid);
    const patch = buildRepairPatch(target);

    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(teamRef);
        if (!freshSnap.exists) {
          skipped.push({
            uid: target.uid,
            reason: 'team_doc_missing_during_apply',
          });
          return;
        }

        const freshData = freshSnap.data() ?? {};
        const freshIssue = resolveIssue(freshData);
        if (!freshIssue) {
          skipped.push({
            uid: target.uid,
            reason: 'already_repaired',
          });
          return;
        }

        tx.set(teamRef, patch, { merge: true });
      });

      repaired.push({
        uid: target.uid,
        teamName: patch.name,
        playerCount: patch.players.length,
        preservedLeagueId:
          typeof target.teamData?.leagueId === 'string' ? target.teamData.leagueId : null,
      });
    } catch (error) {
      failures.push({
        uid: target.uid,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { repaired, skipped, failures };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  await ensureApp(options);

  const db = admin.firestore();
  const auth = admin.auth();
  const authUsersByUid = await loadAuthUsers(auth);
  const targets = await collectTargets({
    db,
    authUsersByUid,
    targetUids: Array.from(new Set(options.targetUids)),
  });

  const preview = targets.map((target) => {
    const patch = buildRepairPatch(target);
    return {
      uid: target.uid,
      issue: target.issue,
      teamName: patch.name,
      manager: patch.manager,
      playerCount: patch.players.length,
      starterCount: patch.plan.starters.length,
      benchCount: patch.plan.bench.length,
      reserveCount: patch.plan.reserves.length,
      budget: patch.budget,
      transferBudget: patch.transferBudget,
      samplePlayers: patch.players.slice(0, 3).map((player) => ({
        id: player.id,
        name: player.name,
        position: player.position,
        overall: player.overall,
      })),
    };
  });

  if (!options.apply) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'dry-run',
      projectId: options.projectId,
      serviceAccountPath: options.serviceAccountPath || null,
      targetCount: preview.length,
      targets: preview,
    }, null, 2));
    return;
  }

  const backupPath = await writeBackupFile(targets);
  const result = await applyRepairs({ db, targets });

  console.log(JSON.stringify({
    ok: result.failures.length === 0,
    mode: 'apply',
    projectId: options.projectId,
    serviceAccountPath: options.serviceAccountPath || null,
    backupPath,
    targetCount: preview.length,
    repairedCount: result.repaired.length,
    skippedCount: result.skipped.length,
    failureCount: result.failures.length,
    repaired: result.repaired,
    skipped: result.skipped,
    failures: result.failures,
  }, null, 2));

  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});

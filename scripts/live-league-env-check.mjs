import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const groups = [
  {
    name: 'match-control-api',
    file: path.join(ROOT, 'services', 'match-control-api', '.env'),
    required: [
      'MATCH_CONTROL_SECRET',
      'MATCH_CONTROL_CALLBACK_TOKEN',
      'SESSION_SIGNING_KEY',
      'MATCH_CONTROL_CALLBACK_BASE_URL',
      'FIREBASE_LIFECYCLE_URL',
      'FIREBASE_LIFECYCLE_TOKEN',
    ],
    recommended: [
      'FIREBASE_PROJECT_ID',
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      'NODE_AGENTS',
      'NODE_AGENTS_FRIENDLY',
      'NODE_AGENTS_LEAGUE',
    ],
  },
  {
    name: 'node-agent',
    file: path.join(ROOT, 'services', 'node-agent', '.env'),
    required: [
      'NODE_AGENT_SECRET',
      'UNITY_SERVER_BINARY',
      'ALLOCATABLE_PORTS',
      'MATCH_CONTROL_CALLBACK_BASE_URL',
      'MATCH_CONTROL_CALLBACK_TOKEN',
    ],
  },
  {
    name: 'functions',
    file: path.join(ROOT, 'src', 'functions', '.env'),
    required: [
      'MATCH_CONTROL_BASE_URL',
      'MATCH_CONTROL_SECRET',
      'LEAGUE_LIFECYCLE_SECRET',
      'BATCH_SECRET',
    ],
  },
  {
    name: 'frontend',
    file: path.join(ROOT, '.env.local'),
    required: ['VITE_MATCH_CONTROL_BASE_URL'],
    recommended: ['VITE_MATCH_CONTROL_BEARER'],
  },
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function maskValue(value) {
  if (!value) return '<missing>';
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

let hasMissing = false;

for (const group of groups) {
  const env = readEnvFile(group.file);
  console.log(`\n[${group.name}] ${path.relative(ROOT, group.file)}`);
  if (!fs.existsSync(group.file)) {
    hasMissing = true;
    console.log('  missing file');
    continue;
  }

  for (const key of group.required) {
    const value = env[key];
    const ok = typeof value === 'string' && value.trim().length > 0;
    if (!ok) hasMissing = true;
    console.log(`  ${ok ? 'ok ' : 'bad'} ${key} = ${maskValue(value || '')}`);
  }

  for (const key of group.recommended || []) {
    const value = env[key];
    const ok = typeof value === 'string' && value.trim().length > 0;
    console.log(`  ${ok ? 'ok ' : 'opt'} ${key} = ${maskValue(value || '')}`);
  }

  if (group.name === 'match-control-api') {
    const hasShared = typeof env.NODE_AGENTS === 'string' && env.NODE_AGENTS.trim().length > 0;
    const hasFriendly = typeof env.NODE_AGENTS_FRIENDLY === 'string' && env.NODE_AGENTS_FRIENDLY.trim().length > 0;
    const hasLeague = typeof env.NODE_AGENTS_LEAGUE === 'string' && env.NODE_AGENTS_LEAGUE.trim().length > 0;
    const poolOk = hasShared || hasFriendly || hasLeague;
    if (!poolOk) hasMissing = true;
    console.log(`  ${poolOk ? 'ok ' : 'bad'} NODE_POOL_CONFIG = ${poolOk ? 'configured' : 'missing NODE_AGENTS and dedicated pools'}`);
    if (hasFriendly !== hasLeague) {
      console.log('  opt NODE_POOL_WARNING = only one dedicated pool is set; other mode falls back to shared/available pool');
    }
  }
}

const functionsEnv = readEnvFile(path.join(ROOT, 'src', 'functions', '.env'));
console.log('\n[firebase functions dotenv]');
console.log('Recommended files:');
console.log('  src/functions/.env.staging');
console.log('  src/functions/.env.prod');
console.log('Current base values:');
console.log(`  MATCH_CONTROL_BASE_URL=${functionsEnv.MATCH_CONTROL_BASE_URL || '<set-me>'}`);
console.log(`  MATCH_CONTROL_SECRET=${maskValue(functionsEnv.MATCH_CONTROL_SECRET || '')}`);
console.log(`  LEAGUE_LIFECYCLE_SECRET=${maskValue(functionsEnv.LEAGUE_LIFECYCLE_SECRET || '')}`);
console.log(`  BATCH_SECRET=${maskValue(functionsEnv.BATCH_SECRET || '')}`);

if (hasMissing) {
  process.exitCode = 1;
  console.error('\nMissing live-league deploy configuration detected.');
} else {
  console.log('\nLive-league deploy configuration looks complete.');
}

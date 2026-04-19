import fs from 'node:fs';
import process from 'node:process';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    envFile: 'services/match-control-api/.env',
    timeoutMs: 10000,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--env-file') out.envFile = args[++index] || out.envFile;
    else if (arg === '--timeout-ms') out.timeoutMs = Number(args[++index] || out.timeoutMs);
  }

  return out;
}

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    env[key] = value;
  }
  return env;
}

function safeParseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeNodeAgentList(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => ({
      id: String(item?.id || '').trim(),
      url: String(item?.url || '').trim().replace(/\/$/, ''),
      token: String(item?.token || '').trim(),
    }))
    .filter((item) => item.id && item.url);
}

function resolvePools(env) {
  const hasSharedEnv = Object.prototype.hasOwnProperty.call(env, 'NODE_AGENTS');
  const hasFriendlyEnv = Object.prototype.hasOwnProperty.call(env, 'NODE_AGENTS_FRIENDLY');
  const hasLeagueEnv = Object.prototype.hasOwnProperty.call(env, 'NODE_AGENTS_LEAGUE');

  const shared = normalizeNodeAgentList(safeParseJson(env.NODE_AGENTS || '[]', []));
  const friendly = hasFriendlyEnv
    ? normalizeNodeAgentList(safeParseJson(env.NODE_AGENTS_FRIENDLY || '[]', []))
    : shared;
  const league = hasLeagueEnv
    ? normalizeNodeAgentList(safeParseJson(env.NODE_AGENTS_LEAGUE || '[]', []))
    : shared;

  return {
    hasSharedEnv,
    friendly,
    league,
  };
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text || '<empty>'}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeParity(entries) {
  const keys = ['buildId', 'assemblyHash', 'gameAssemblyHash'];
  const summary = {};
  for (const key of keys) {
    const values = Array.from(
      new Set(
        entries
          .map((entry) => String(entry.runtime?.[key] || '').trim())
          .filter(Boolean),
      ),
    );
    summary[key] = {
      uniqueValues: values,
      mismatch: values.length > 1,
    };
  }
  return summary;
}

async function run() {
  const args = parseArgs();
  const env = parseEnvFile(args.envFile);
  const pools = resolvePools(env);
  const byNode = new Map();

  for (const [poolName, nodes] of Object.entries({
    friendly: pools.friendly,
    league: pools.league,
  })) {
    for (const node of nodes) {
      const previous = byNode.get(node.url) || {
        id: node.id,
        url: node.url,
        pools: [],
      };
      previous.pools = Array.from(new Set([...previous.pools, poolName]));
      previous.id = previous.id || node.id;
      byNode.set(node.url, previous);
    }
  }

  const results = [];
  for (const node of byNode.values()) {
    try {
      const health = await fetchJson(`${node.url}/health`, args.timeoutMs);
      results.push({
        id: node.id,
        url: node.url,
        pools: node.pools,
        ok: true,
        runtime: {
          buildId: String(health?.runtime?.buildId || '').trim() || null,
          assemblyHash: String(health?.runtime?.assemblyHash || '').trim() || null,
          gameAssemblyHash: String(health?.runtime?.gameAssemblyHash || '').trim() || null,
          gitSha: String(health?.runtime?.gitSha || '').trim() || null,
          runtimeType: String(health?.runtime?.runtimeType || '').trim() || null,
        },
      });
    } catch (error) {
      results.push({
        id: node.id,
        url: node.url,
        pools: node.pools,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const successful = results.filter((entry) => entry.ok);

  console.log(JSON.stringify({
    envFile: args.envFile,
    hasSharedEnv: pools.hasSharedEnv,
    friendlyCount: pools.friendly.length,
    leagueCount: pools.league.length,
    results,
    parity: summarizeParity(successful),
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    count: 200,
    parallel: 25,
    kickoff: false,
    cleanup: false,
    baseUrl: process.env.MATCH_CONTROL_BASE_URL || '',
    secret: process.env.MATCH_CONTROL_SECRET || '',
    callbackToken: process.env.MATCH_CONTROL_CALLBACK_TOKEN || '',
    seasonId: `load-${new Date().toISOString().slice(0, 10)}`,
    leaguePrefix: 'load-league',
    fixturePrefix: 'load-fixture',
    outputFile: '',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--count') out.count = Number(args[++i] || '200');
    else if (arg === '--parallel') out.parallel = Number(args[++i] || '25');
    else if (arg === '--kickoff') out.kickoff = true;
    else if (arg === '--cleanup') out.cleanup = true;
    else if (arg === '--base-url') out.baseUrl = args[++i] || '';
    else if (arg === '--secret') out.secret = args[++i] || '';
    else if (arg === '--callback-token') out.callbackToken = args[++i] || '';
    else if (arg === '--season-id') out.seasonId = args[++i] || out.seasonId;
    else if (arg === '--league-prefix') out.leaguePrefix = args[++i] || out.leaguePrefix;
    else if (arg === '--fixture-prefix') out.fixturePrefix = args[++i] || out.fixturePrefix;
    else if (arg === '--out') out.outputFile = args[++i] || '';
  }

  if (!out.baseUrl || !out.secret) {
    throw new Error('MATCH_CONTROL_BASE_URL and MATCH_CONTROL_SECRET are required.');
  }

  return out;
}

function createDummyPlayer(teamSeed, index) {
  return {
    playerId: `${teamSeed}-p${index + 1}`,
    name: `Player ${index + 1}`,
    order: index,
    attributes: {
      strength: 60,
      acceleration: 60,
      topSpeed: 60,
      dribbleSpeed: 60,
      jump: 60,
      tackling: 60,
      ballKeeping: 60,
      passing: 60,
      longBall: 60,
      agility: 60,
      shooting: 60,
      shootPower: 60,
      positioning: 60,
      reaction: 60,
      ballControl: 60,
      height: 180,
      weight: 75,
    },
  };
}

function createTeamPayload(teamKey) {
  return {
    teamKey,
    teamName: teamKey,
    formation: '4-2-3-1',
    kit: {
      primary: '#0EA5E9',
      secondary: '#111827',
      text: '#FFFFFF',
      gkPrimary: '#F97316',
      gkSecondary: '#111827',
    },
    lineup: Array.from({ length: 11 }, (_, index) => createDummyPlayer(teamKey, index)),
    bench: Array.from({ length: 12 }, (_, index) => createDummyPlayer(`${teamKey}-b`, index)),
  };
}

async function requestJson(baseUrl, secret, path, init) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
      ...(init?.headers || {}),
    },
  });

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let index = 0;

  async function next() {
    const current = index;
    index += 1;
    if (current >= items.length) {
      return;
    }
    results[current] = await worker(items[current], current);
    await next();
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => next());
  await Promise.all(workers);
  return results;
}

async function runWithConcurrencySettled(items, limit, worker) {
  const results = Array(items.length).fill(null);
  const errors = [];
  let index = 0;

  async function next() {
    const current = index;
    index += 1;
    if (current >= items.length) {
      return;
    }

    try {
      results[current] = await worker(items[current], current);
    } catch (error) {
      errors.push({
        index: current,
        item: items[current],
        error,
      });
    }

    await next();
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => next());
  await Promise.all(workers);
  return { results, errors };
}

async function cleanupPrepared(args, prepared) {
  if (!args.cleanup || !args.callbackToken || !prepared.length) {
    return;
  }

  console.log('[load-test] cleanup via lifecycle failed state');
  await runWithConcurrency(prepared, args.parallel, async (entry) => {
    await requestJson(args.baseUrl, args.callbackToken, `/v1/internal/matches/${encodeURIComponent(entry.result.matchId)}/lifecycle`, {
      method: 'POST',
      body: JSON.stringify({
        matchId: entry.result.matchId,
        fixtureId: entry.payload.fixtureId,
        leagueId: entry.payload.leagueId,
        state: 'failed',
        reason: 'load_test_cleanup',
      }),
    });
    return true;
  });
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)));
  return sorted[idx];
}

async function run() {
  const args = parseArgs();
  const kickoffAt = new Date().toISOString();
  const matches = Array.from({ length: args.count }, (_, index) => {
    const suffix = String(index + 1).padStart(4, '0');
    const fixtureId = `${args.fixturePrefix}-${suffix}`;
    const leagueId = `${args.leaguePrefix}-${Math.floor(index / 8) + 1}`;
    const homeTeamId = `${fixtureId}-home`;
    const awayTeamId = `${fixtureId}-away`;
    return {
      matchId: fixtureId,
      fixtureId,
      leagueId,
      homeTeamId,
      awayTeamId,
      seasonId: args.seasonId,
      kickoffAt,
      homeUserId: `${homeTeamId}-user`,
      awayUserId: `${awayTeamId}-user`,
      homeTeamPayload: createTeamPayload(homeTeamId),
      awayTeamPayload: createTeamPayload(awayTeamId),
      resultUploadUrl: `https://example.invalid/results/${fixtureId}.json`,
      replayUploadUrl: `https://example.invalid/replays/${fixtureId}.json`,
      videoUploadUrl: `https://example.invalid/videos/${fixtureId}.mp4`,
      requestToken: crypto.randomUUID(),
    };
  });

  console.log(`[load-test] prepare ${matches.length} matches with parallel=${args.parallel}`);
  const prepareLatencies = [];
  const kickoffLatencies = [];
  const prepareRun = await runWithConcurrencySettled(matches, args.parallel, async (payload) => {
    const startedAt = Date.now();
    const result = await requestJson(args.baseUrl, args.secret, '/v1/league/prepare-slot', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    prepareLatencies.push(Date.now() - startedAt);
    return { payload, result };
  });

  const prepared = prepareRun.results.filter(Boolean);

  if (prepareRun.errors.length) {
    await cleanupPrepared(args, prepared);
    const firstError = prepareRun.errors[0]?.error;
    throw new Error(`prepare_failed_count=${prepareRun.errors.length} first=${firstError?.message || 'unknown_error'}`);
  }

  if (args.kickoff) {
    console.log(`[load-test] kickoff ${prepared.length} matches`);
    const kickoffRun = await runWithConcurrencySettled(prepared, args.parallel, async (entry) => {
      const startedAt = Date.now();
      const result = await requestJson(args.baseUrl, args.secret, '/v1/league/kickoff-slot', {
        method: 'POST',
        body: JSON.stringify({ matchId: entry.result.matchId }),
      });
      kickoffLatencies.push(Date.now() - startedAt);
      return { ...entry, kickoff: result };
    });

    if (kickoffRun.errors.length) {
      await cleanupPrepared(args, prepared);
      const firstError = kickoffRun.errors[0]?.error;
      throw new Error(`kickoff_failed_count=${kickoffRun.errors.length} first=${firstError?.message || 'unknown_error'}`);
    }
  }

  await cleanupPrepared(args, prepared);

  const output = {
    total: matches.length,
    kickedOff: args.kickoff,
    cleanedUp: args.cleanup && Boolean(args.callbackToken),
    prepare: {
      minMs: Math.min(...prepareLatencies),
      p50Ms: percentile(prepareLatencies, 0.5),
      p95Ms: percentile(prepareLatencies, 0.95),
      p99Ms: percentile(prepareLatencies, 0.99),
      maxMs: Math.max(...prepareLatencies),
    },
    kickoff: kickoffLatencies.length
      ? {
          minMs: Math.min(...kickoffLatencies),
          p50Ms: percentile(kickoffLatencies, 0.5),
          p95Ms: percentile(kickoffLatencies, 0.95),
          p99Ms: percentile(kickoffLatencies, 0.99),
          maxMs: Math.max(...kickoffLatencies),
        }
      : null,
  };

  if (args.outputFile) {
    fs.writeFileSync(path.resolve(args.outputFile), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(output, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

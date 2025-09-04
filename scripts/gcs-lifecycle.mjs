#!/usr/bin/env node
/*
  Helper to apply/describe GCS bucket lifecycle for Firebase Storage.

  Usage:
    node scripts/gcs-lifecycle.mjs apply [--project <id>] [--bucket <name>]
    node scripts/gcs-lifecycle.mjs describe [--project <id>] [--bucket <name>]

  Defaults:
    - projectId: from env PROJECT_ID or .firebaserc (projects.default)
    - bucket:    from env BUCKET or "<projectId>.appspot.com"

  Requires: gcloud CLI installed and authenticated for the project.
*/
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

function parseArgs(argv) {
  const args = { cmd: undefined, project: undefined, bucket: undefined };
  const rest = [...argv];
  args.cmd = rest.shift();
  while (rest.length) {
    const k = rest.shift();
    if (k === '--project') args.project = rest.shift();
    else if (k === '--bucket') args.bucket = rest.shift();
  }
  return args;
}

function readDefaultProject() {
  try {
    const p = path.resolve(process.cwd(), '.firebaserc');
    const txt = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(txt);
    return json?.projects?.default || null;
  } catch {
    return null;
  }
}

function ensureLifecycleFile() {
  const lifecyclePath = path.resolve(process.cwd(), 'infra', 'storage-lifecycle.json');
  if (!fs.existsSync(lifecyclePath)) {
    console.error(`[gcs-lifecycle] lifecycle file not found: ${lifecyclePath}`);
    process.exit(1);
  }
  // Basic validation
  try {
    const json = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'));
    if (!json || (typeof json !== 'object')) throw new Error('not object');
  } catch (e) {
    console.error(`[gcs-lifecycle] invalid JSON at infra/storage-lifecycle.json: ${e?.message || e}`);
    process.exit(1);
  }
  return lifecyclePath;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status || 1);
}

function main() {
  const [, , rawCmd, ...rest] = process.argv;
  const { cmd, project, bucket } = parseArgs([rawCmd, ...rest]);
  if (!cmd || !['apply', 'describe'].includes(cmd)) {
    console.log('Usage: node scripts/gcs-lifecycle.mjs <apply|describe> [--project <id>] [--bucket <name>]');
    process.exit(1);
  }

  const projectId = project || process.env.PROJECT_ID || readDefaultProject();
  if (!projectId) {
    console.error('[gcs-lifecycle] project id is required. Pass --project <id> or set PROJECT_ID env or configure .firebaserc');
    process.exit(1);
  }
  const bucketName = bucket || process.env.BUCKET || `${projectId}.appspot.com`;
  const gsUri = `gs://${bucketName}`;
  const lifecyclePath = ensureLifecycleFile();

  console.log(`[gcs-lifecycle] project: ${projectId}`);
  console.log(`[gcs-lifecycle] bucket : ${bucketName}`);

  if (cmd === 'apply') {
    console.log('[gcs-lifecycle] Applying lifecycle policy...');
    run('gcloud', [
      'storage', 'buckets', 'update', gsUri,
      `--lifecycle-file=${lifecyclePath}`,
      `--project=${projectId}`
    ]);
  } else if (cmd === 'describe') {
    console.log('[gcs-lifecycle] Describing lifecycle policy...');
    run('gcloud', [
      'storage', 'buckets', 'describe', gsUri,
      '--format=value(lifecycle)',
      `--project=${projectId}`
    ]);
  }
}

main();


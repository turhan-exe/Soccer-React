#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, cp } from 'node:fs/promises';
import path from 'node:path';

const srcDir = path.resolve(process.cwd(), 'Unity', 'match-viewer');
const destDir = path.resolve(process.cwd(), 'public', 'Unity', 'match-viewer');

async function main() {
  try {
    await access(srcDir, constants.R_OK);
  } catch {
    console.warn('[copy-unity] Source not found:', srcDir);
    return;
  }
  await cp(srcDir, destDir, { recursive: true });
  console.log('[copy-unity] Copied', srcDir, '->', destDir);
}

main().catch((e) => {
  console.error('[copy-unity] Failed', e);
  process.exit(1);
});

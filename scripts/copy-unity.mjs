#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const srcDir = path.resolve(process.cwd(), 'Unity', 'match-viewer');
const destDir = path.resolve(process.cwd(), 'public', 'Unity', 'match-viewer');

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isFile()) {
      await fsp.copyFile(s, d);
    }
  }
}

async function main() {
  try {
    await fsp.access(srcDir, fs.constants.R_OK);
  } catch {
    console.warn('[copy-unity] Source not found:', srcDir);
    return;
  }
  await copyDir(srcDir, destDir);
  console.log('[copy-unity] Copied', srcDir, '→', destDir);
}

main().catch((e) => {
  console.error('[copy-unity] Failed', e);
  process.exit(1);
});


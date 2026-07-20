'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DATABASE_URL = 'file:./prisma/dev.db';

/**
 * Load `.env` into `process.env` for keys that are not already set.
 * Prisma CLI reads `DATABASE_URL` via `prisma.config.ts` before Next loads env.
 */
function loadDotEnvIfPresent() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function resolvePrismaCli() {
  try {
    return require.resolve('prisma/build/index.js');
  } catch {
    return null;
  }
}

/**
 * Apply pending Prisma migrations (`migrate deploy`) and exit the process on failure.
 * Safe for both `npm run dev` and `npm start` — non-interactive, no schema drift prompts.
 */
function ensurePrismaMigrated() {
  loadDotEnvIfPresent();
  if (!process.env.DATABASE_URL || !String(process.env.DATABASE_URL).trim()) {
    process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
  }

  const prismaCli = resolvePrismaCli();
  if (!prismaCli) {
    console.error(
      '[prisma] Could not resolve local prisma CLI. Run `npm install` first.',
    );
    process.exit(1);
  }

  console.log('[prisma] Applying pending migrations (migrate deploy)...');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });

  if (result.error) {
    console.error(
      `[prisma] Failed to start migrate deploy: ${result.error.message}`,
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(
      `[prisma] migrate deploy exited with code ${result.status ?? 1}`,
    );
    process.exit(result.status ?? 1);
  }
}

module.exports = { ensurePrismaMigrated };

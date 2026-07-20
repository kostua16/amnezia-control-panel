const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * True when an env value is missing or only whitespace.
 * @param {string | undefined} value
 */
function isUnset(value) {
  return value === undefined || String(value).trim() === '';
}

/**
 * Parse a single dotenv line into [key, value], or null if not a assignment.
 * @param {string} line
 * @returns {[string, string] | null}
 */
function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

/**
 * Load one `.env` file, filling only keys that are currently unset in process.env.
 * @param {string} filePath
 */
function loadEnvFileIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (isUnset(process.env[key])) {
      process.env[key] = value;
    }
  }
}

/**
 * Load `.env*` files in Next-like priority (highest first) without overriding
 * already-set process env (shell / parent always wins).
 * @param {string} root
 * @param {boolean} isDev
 */
function loadEnvFiles(root, isDev) {
  const mode = isDev ? 'development' : 'production';
  // Highest priority first so lower-priority files cannot fill a key already
  // taken by a more specific file (or by the process environment).
  const files = [`.env.${mode}.local`, `.env.local`, `.env.${mode}`, `.env`];
  for (const name of files) {
    loadEnvFileIfPresent(path.join(root, name));
  }
}

/**
 * Load `.env*` then fill launch defaults for local/prod scripts.
 *
 * - Always: generate an ephemeral `JWT_SECRET` when unset (after `.env` load).
 * - Development only: default `ADMIN_PASSWORD` to `admin` when unset.
 *
 * Must run before spawning `server.mjs` so the child inherits these values.
 *
 * @param {{
 *   mode: 'development' | 'production',
 *   root?: string,
 * }} options
 */
function ensureRuntimeEnv(options) {
  const root = options.root ?? path.join(__dirname, '..');
  const isDev = options.mode === 'development';

  loadEnvFiles(root, isDev);

  if (isUnset(process.env.JWT_SECRET)) {
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[ensure-runtime-env] JWT_SECRET was not set — generated an ephemeral secret for this process. ' +
        'Add JWT_SECRET to .env to keep sessions across restarts.',
    );
  }

  if (isDev && isUnset(process.env.ADMIN_PASSWORD)) {
    process.env.ADMIN_PASSWORD = 'admin';
    console.warn(
      '[ensure-runtime-env] ADMIN_PASSWORD was not set — using default "admin" for development.',
    );
  }
}

module.exports = {
  ensureRuntimeEnv,
  isUnset,
  // Exported for unit tests
  parseEnvLine,
  loadEnvFiles,
};

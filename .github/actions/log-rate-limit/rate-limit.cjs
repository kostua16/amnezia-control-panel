/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { createHash } = require('node:crypto');

const DEFAULT_API_URL = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 10_000;

function formatBucket(bucket) {
  if (!bucket || bucket.remaining === undefined || bucket.limit === undefined)
    return 'n/a';
  return `${bucket.remaining}/${bucket.limit}`;
}

function formatReset(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return 'n/a';
  return new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Only the public prefix is reported (ghs = Actions/App installation token, ghp or github_pat = PAT),
// so lines from jobs that pass different tokens can be told apart: each token has its own quota.
function tokenKind(token) {
  const match = String(token ?? '').match(/^(github_pat|gh[pousr])_/);
  return match ? match[1] : 'unknown';
}

// Short one-way fingerprint of the token (first 8 hex chars of its SHA-256). It reveals nothing
// usable about the secret but lets lines be grouped by the exact token that produced them, e.g.
// to tell whether the start and the end of one job read the same quota bucket.
function tokenFingerprint(token) {
  const value = String(token ?? '');
  if (!value) return 'none';
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function formatRateLimitLine({ env, phase, label, resources }) {
  const core = resources?.core;
  return [
    'RATE_LIMIT',
    `phase=${phase}`,
    `workflow="${env.GITHUB_WORKFLOW ?? ''}"`,
    `job=${env.GITHUB_JOB ?? ''}`,
    `label=${label || env.GITHUB_JOB || ''}`,
    `run=${env.GITHUB_RUN_ID ?? ''}.${env.GITHUB_RUN_ATTEMPT ?? ''}`,
    `event=${env.GITHUB_EVENT_NAME ?? ''}`,
    `token=${tokenKind(env['INPUT_GITHUB-TOKEN'])}`,
    `token_id=${tokenFingerprint(env['INPUT_GITHUB-TOKEN'])}`,
    `core_remaining=${formatBucket(core)}`,
    `core_reset=${formatReset(core?.reset)}`,
    `graphql=${formatBucket(resources?.graphql)}`,
  ].join(' ');
}

async function fetchRateLimit({ token, apiUrl, fetchImpl }) {
  const response = await fetchImpl(`${apiUrl}/rate_limit`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.resources;
}

/**
 * Logs one greppable RATE_LIMIT line. GET /rate_limit does not consume quota, and any
 * failure only produces a warning so the diagnostic can never fail a job.
 */
async function logRateLimit({
  env = process.env,
  phase,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const label = env.INPUT_LABEL ?? '';
  try {
    const resources = await fetchRateLimit({
      token: env['INPUT_GITHUB-TOKEN'],
      apiUrl: env.GITHUB_API_URL || DEFAULT_API_URL,
      fetchImpl,
    });
    log(formatRateLimitLine({ env, phase, label, resources }));
  } catch (error) {
    log(
      `::warning::Unable to read the GitHub API rate limit (${label || env.GITHUB_JOB}): ${error.message}`,
    );
  }
}

module.exports = {
  formatRateLimitLine,
  logRateLimit,
  tokenFingerprint,
  tokenKind,
};

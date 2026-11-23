/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { appendFileSync } = require('node:fs');
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

// Short one-way fingerprint of the token (first 12 hex chars of its SHA-256) so lines can be
// grouped by the exact token that produced them, e.g. to tell whether the start and the end of
// one job read the same quota bucket. Deliberately unkeyed: grouping across jobs needs a value
// every job can compute, and a keyed digest would need a repository secret that fork PRs and
// several call sites do not have. Installation tokens expire within the hour; a long-lived PAT
// would keep a permanent digest in the logs, but anyone able to confirm a candidate against it
// already holds the full token (one API call verifies it anyway), and the 48-bit prefix of a
// high-entropy token cannot be inverted. 48 bits keep collisions between the few tokens alive in
// one window negligible.
function tokenFingerprint(token) {
  const value = String(token ?? '');
  if (!value) return 'none';
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
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

// Exposes the remaining core (REST) quota as the step output `core-remaining`
// so callers can stop a job before side effects when the bucket is already
// empty, without a second API call. Empty when the reading failed.
function writeCoreRemainingOutput({ env = process.env, resources } = {}) {
  if (!env.GITHUB_OUTPUT) return;
  const remaining = resources?.core?.remaining;
  const value = Number.isInteger(remaining) ? String(remaining) : '';
  appendFileSync(
    env.GITHUB_OUTPUT,
    `core-remaining=${value}
`,
  );
}

/**
 * Logs one greppable RATE_LIMIT line. GET /rate_limit does not consume quota, and any
 * failure only produces a warning so the diagnostic can never fail a job.
 * Returns the rate-limit resources, or null when they could not be read.
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
    return resources ?? null;
  } catch (error) {
    log(
      `::warning::Unable to read the GitHub API rate limit (${label || env.GITHUB_JOB}): ${error.message}`,
    );
    return null;
  }
}

module.exports = {
  formatRateLimitLine,
  logRateLimit,
  tokenFingerprint,
  tokenKind,
  writeCoreRemainingOutput,
};

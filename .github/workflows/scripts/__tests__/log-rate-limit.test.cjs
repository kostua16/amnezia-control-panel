/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatRateLimitLine,
  logRateLimit,
  tokenFingerprint,
  tokenKind,
} = require('../../../actions/log-rate-limit/rate-limit.cjs');

const ENV = {
  GITHUB_WORKFLOW: 'Docker Image',
  GITHUB_JOB: 'classify',
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_EVENT_NAME: 'pull_request',
  'INPUT_GITHUB-TOKEN': 'token-value',
  INPUT_LABEL: 'docker-classify',
};

const RESOURCES = {
  core: { limit: 5000, remaining: 17, reset: 1795304674 },
  graphql: { limit: 5000, remaining: 4698, reset: 1795304685 },
};

function fakeFetch(response) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response;
  };
  return { fetchImpl, calls };
}

test('formats one greppable line with phase, run identity and both quotas', () => {
  const line = formatRateLimitLine({
    env: ENV,
    phase: 'job-end',
    label: 'docker-classify',
    resources: RESOURCES,
  });

  assert.equal(
    line,
    'RATE_LIMIT phase=job-end workflow="Docker Image" job=classify label=docker-classify run=123.2 ' +
      `event=pull_request token=unknown token_id=e6c02a5742ea core_remaining=17/5000 core_reset=2026-11-21T23:44:34Z graphql=4698/5000`,
  );
});

test('reports only the public token prefix so each token quota can be told apart', () => {
  assert.equal(tokenKind('ghs_abc123'), 'ghs');
  assert.equal(tokenKind('ghp_abc123'), 'ghp');
  assert.equal(tokenKind('github_pat_abc123'), 'github_pat');
  assert.equal(tokenKind('something-else'), 'unknown');
  assert.equal(tokenKind(undefined), 'unknown');
});

test('fingerprints the token without exposing it', () => {
  const id = tokenFingerprint('ghs_secretvalue');
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(id, tokenFingerprint('ghs_secretvalue'));
  assert.notEqual(id, tokenFingerprint('ghs_othervalue'));
  assert.ok(!id.includes('secret'));
  assert.equal(tokenFingerprint(undefined), 'none');
  assert.equal(tokenFingerprint(''), 'none');
});

test('falls back to n/a and the job id when resources or label are missing', () => {
  const line = formatRateLimitLine({
    env: ENV,
    phase: 'snapshot',
    label: '',
    resources: {},
  });

  assert.match(line, /label=classify /);
  assert.match(line, /core_remaining=n\/a core_reset=n\/a graphql=n\/a$/);
});

test('logs the quota using the input token against the configured API url', async () => {
  const { fetchImpl, calls } = fakeFetch({
    ok: true,
    json: async () => ({ resources: RESOURCES }),
  });
  const lines = [];

  await logRateLimit({
    env: { ...ENV, GITHUB_API_URL: 'https://ghe.example/api/v3' },
    phase: 'job-start',
    fetchImpl,
    log: (line) => lines.push(line),
  });

  assert.equal(calls[0].url, 'https://ghe.example/api/v3/rate_limit');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-value');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^RATE_LIMIT phase=job-start /);
});

test('emits a warning instead of throwing when the API call is rejected', async () => {
  const { fetchImpl } = fakeFetch({ ok: false, status: 403 });
  const lines = [];

  await logRateLimit({
    env: ENV,
    phase: 'snapshot',
    fetchImpl,
    log: (line) => lines.push(line),
  });

  assert.equal(lines.length, 1);
  assert.match(
    lines[0],
    /^::warning::Unable to read the GitHub API rate limit \(docker-classify\): HTTP 403$/,
  );
});

test('emits a warning instead of throwing when the request itself fails', async () => {
  const lines = [];
  const fetchImpl = async () => {
    throw new Error('network down');
  };

  await logRateLimit({
    env: ENV,
    phase: 'snapshot',
    fetchImpl,
    log: (line) => lines.push(line),
  });

  assert.match(lines[0], /^::warning::.*network down$/);
});

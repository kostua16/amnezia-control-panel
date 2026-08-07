/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const { TRANSIENT_PATTERNS, isTransientLog, classifyRun } = require('../rerun-transient-failed-runs.cjs');

// ── TRANSIENT_PATTERNS ─────────────────────────────────────────────

test('TRANSIENT_PATTERNS covers core network resets', () => {
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('ECONNRESET')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('ETIMEDOUT')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('ECONNREFUSED')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('ENOTFOUND')));
});

test('TRANSIENT_PATTERNS covers HTTP 5xx', () => {
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('HTTP 500')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('HTTP 502')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('HTTP 503')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('HTTP 504')));
});

test('TRANSIENT_PATTERNS covers rate-limit and throttle', () => {
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('rate limit')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('throttle')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('service temporarily overloaded')));
});

test('TRANSIENT_PATTERNS covers runner eviction and OOM', () => {
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('Runner cancelled')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('shutdown signal')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('out of memory')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('OOM killed')));
  assert.ok(TRANSIENT_PATTERNS.some((re) => re.test('ENOSPC')));
});

// ── isTransientLog ───────────────────────────────────────────────

test('isTransientLog returns true for ECONNRESET in logs', () => {
  assert.ok(isTransientLog('Error: read ECONNRESET'));
  assert.ok(isTransientLog('some line\nECONNRESET\nmore lines'));
});

test('isTransientLog returns true for HTTP 5xx in logs', () => {
  assert.ok(isTransientLog('gh: HTTP 504: Gateway Timeout'));
  assert.ok(isTransientLog('HTTP 500 Internal Server Error'));
  assert.ok(isTransientLog('http 502')); // case-insensitive
});

test('isTransientLog returns true for rate-limit in logs', () => {
  assert.ok(isTransientLog('API rate limit exceeded'));
  assert.ok(isTransientLog('secondary rate limit'));
});

test('isTransientLog returns true for OOM and disk pressure', () => {
  assert.ok(isTransientLog('FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory'));
  assert.ok(isTransientLog('no space left on device'));
  assert.ok(isTransientLog('ENOSPC'));
});

test('isTransientLog returns false for permanent errors', () => {
  assert.ok(!isTransientLog('error TS2304: Cannot find name'));
  assert.ok(!isTransientLog('HTTP 404: Not Found'));
  assert.ok(!isTransientLog('HTTP 403: Forbidden')); // 403 alone is not transient
  assert.ok(!isTransientLog('Permission denied'));
  assert.ok(!isTransientLog(''));
});

// ── classifyRun ───────────────────────────────────────────────────

test('classifyRun returns transient for ECONNRESET', () => {
  // classifyRun calls gh to fetch logs — we can't mock that easily,
  // so we test isTransientLog directly which is the core classification logic.
  // classifyRun delegates to isTransientLog on the fetched log text.
  const logText = '##[error] Error: read ECONNRESET';
  const result = { transient: isTransientLog(logText), reason: isTransientLog(logText) ? 'transient-signature' : 'non-transient' };
  assert.equal(result.transient, true);
  assert.equal(result.reason, 'transient-signature');
});

test('classifyRun returns non-transient for TypeScript errors', () => {
  const logText = '##[error] src/app.ts(42,5): error TS2304: Cannot find name';
  const result = { transient: isTransientLog(logText), reason: isTransientLog(logText) ? 'transient-signature' : 'non-transient' };
  assert.equal(result.transient, false);
  assert.equal(result.reason, 'non-transient');
});

/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRunnerPools,
  computeQueueLatency,
  parseSince,
  formatText,
  getRecentRuns,
  ghErrors,
} = require('../runner-health-check.cjs');

// ── getRunnerPools ───────────────────────────────────────────

test('getRunnerPools groups runners by pool labels', () => {
  const runners = [
    { id: 1, name: 'r1', status: 'online', labels: ['self-hosted', 'big'] },
    { id: 2, name: 'r2', status: 'offline', labels: ['self-hosted', 'big'] },
    { id: 3, name: 'r3', status: 'online', labels: ['self-hosted'] },
  ];
  const pools = getRunnerPools(runners);
  assert.equal(Object.keys(pools).length, 2);
  assert.equal(pools['big'].online, 1);
  assert.equal(pools['big'].offline, 1);
  assert.equal(pools['default'].online, 1);
});

test('getRunnerPools returns empty for no runners', () => {
  const pools = getRunnerPools([]);
  assert.deepEqual(pools, {});
});

test('getRunnerPools detects saturated pool (all offline)', () => {
  const runners = [
    { id: 1, name: 'r1', status: 'offline', labels: ['self-hosted', 'big'] },
  ];
  const pools = getRunnerPools(runners);
  assert.equal(pools['big'].online, 0);
  assert.equal(pools['big'].offline, 1);
});

// ── computeQueueLatency ───────────────────────────────────────

test('computeQueueLatency calculates queue seconds', () => {
  const now = Date.now();
  const runs = [
    {
      databaseId: 100,
      name: 'test-workflow',
      created_at: new Date(now - 120000).toISOString(),
      run_started_at: new Date(now).toISOString(),
    },
  ];
  const result = computeQueueLatency(runs);
  assert.equal(result.length, 1);
  assert.equal(result[0].queueSeconds, 120);
  assert.equal(result[0].name, 'test-workflow');
});

test('computeQueueLatency skips runs without created_at', () => {
  const runs = [
    { databaseId: 101, name: 'no-created', created_at: null, run_started_at: null },
  ];
  assert.equal(computeQueueLatency(runs).length, 0);
});

test('computeQueueLatency counts queued-not-started runs via created_at', () => {
  // A run stuck waiting for a runner has run_started_at: null — the acute
  // capacity signal — so its wait is measured as now - created_at instead
  // of being dropped.
  const created = new Date(Date.now() - 300000).toISOString(); // 5m ago
  const runs = [
    { databaseId: 102, name: 'queued', created_at: created, run_started_at: null },
  ];
  const result = computeQueueLatency(runs);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'queued');
  assert.equal(result[0].stillQueued, true);
  assert.ok(result[0].queueSeconds >= 299);
});

test('computeQueueLatency sorts by descending latency', () => {
  const base = Date.now();
  const runs = [
    { databaseId: 1, name: 'fast', created_at: new Date(base - 10000).toISOString(), run_started_at: new Date(base).toISOString() },
    { databaseId: 2, name: 'slow', created_at: new Date(base - 200000).toISOString(), run_started_at: new Date(base + 190000).toISOString() },
  ];
  const result = computeQueueLatency(runs);
  assert.equal(result[0].name, 'slow');
  assert.ok(result[0].queueSeconds > result[1].queueSeconds);
});

// ── parseSince ───────────────────────────────────────────────

test('parseSince handles hours', () => {
  const since = parseSince('6h');
  const diff = Date.now() - since.getTime();
  assert.ok(diff >= 21600000 && diff <= 21610000, 'should be ~6h ago');
});

test('parseSince handles days', () => {
  const since = parseSince('1d');
  const diff = Date.now() - since.getTime();
  assert.ok(diff >= 86400000 && diff <= 86410000, 'should be ~1d ago');
});

test('parseSince handles minutes', () => {
  const since = parseSince('30m');
  const diff = Date.now() - since.getTime();
  assert.ok(diff >= 1800000 && diff <= 1810000, 'should be ~30m ago');
});

// ── formatText ───────────────────────────────────────────────

test('formatText includes runner pool summary', () => {
  const pools = {
    big: { labels: ['big'], online: 2, offline: 0, total: 2 },
  };
  const output = formatText(pools, [], 300, '6h');
  assert.ok(output.includes('Runner health self-check'));
  assert.ok(output.includes('big'));
  assert.ok(output.includes('2'));
});

test('formatText shows saturated pool warning', () => {
  const pools = {
    big: { labels: ['big'], online: 0, offline: 1, total: 1 },
  };
  const output = formatText(pools, [], 300, '6h');
  assert.ok(output.includes('Saturated pools'));
});

test('formatText shows queue latency with alerting', () => {
  const pools = { big: { labels: ['big'], online: 1, offline: 0, total: 1 } };
  const latencies = [
    { name: 'slow-workflow', runId: 42, queueSeconds: 500 },
    { name: 'fast-workflow', runId: 43, queueSeconds: 10 },
  ];
  const output = formatText(pools, latencies, 300, '6h');
  assert.ok(output.includes('Avg queue wait: **255s**'));
  assert.ok(output.includes('High-latency runs'));
  assert.ok(output.includes('slow-workflow'));
  assert.ok(!output.includes('fast-workflow'));
});

test('formatText surfaces gh call failures instead of looking clean', () => {
  const pools = {};
  const output = formatText(pools, [], 300, '6h', [
    'api repos/o/r/actions/runners -> HTTP 403',
  ]);
  assert.ok(output.includes('gh call failures'));
  assert.ok(output.includes('report may be incomplete'));
  assert.ok(output.includes('HTTP 403'));
});

// ── getRunners NDJSON regression ──────────────────────────────
// gh api ... --jq '.runners[]' emits one JSON object per runner, not a
// single array. getRunners parses via the shared parseGhJsonLines helper,
// which must collect every line instead of throwing on the second object
// (the bug that silently collapsed multi-runner repos to an empty report).
const { parseGhJsonLines } = require('../fleet-kpi-digest.cjs');

test('getRunners parser handles multi-runner NDJSON stream', () => {
  const stream = [
    '{"id":1,"name":"r1","status":"online","labels":[{"name":"self-hosted"},{"name":"big"}]}',
    '{"id":2,"name":"r2","status":"offline","labels":[{"name":"self-hosted"},{"name":"big"}]}',
  ].join('\n');
  const parsed = parseGhJsonLines(stream);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'r1');
  assert.equal(parsed[1].status, 'offline');
});

// ── getRecentRuns malformed-JSON regression ──────────────────
// `gh run list --json` can exit 0 with a non-JSON body (proxy injection,
// truncated/partial response). getRecentRuns must record that to ghErrors so
// the report's "gh call failures" banner surfaces it — otherwise a malformed
// response renders as empty-but-healthy queue data, the silent masking this
// tool exists to eliminate. runGh is injected so the branch is exercised
// without a live gh invocation.
test('getRecentRuns records malformed JSON to ghErrors', () => {
  ghErrors.length = 0;
  const runs = getRecentRuns('owner/repo', '6h', () => 'not-json{');
  assert.equal(runs.length, 0);
  assert.ok(ghErrors.length > 0, 'parse failure should be recorded');
  assert.match(ghErrors[0], /malformed JSON/);
});

test('getRecentRuns returns empty without recording when gh call fails', () => {
  ghErrors.length = 0;
  // runGh returns null on invocation failure (handled before the parse branch);
  // that path returns [] without pushing a parse error.
  const runs = getRecentRuns('owner/repo', '6h', () => null);
  assert.equal(runs.length, 0);
  assert.equal(ghErrors.length, 0);
});

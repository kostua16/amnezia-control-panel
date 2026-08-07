/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRunnerPools,
  computeQueueLatency,
  parseSince,
  formatText,
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

test('computeQueueLatency skips runs without timestamps', () => {
  const runs = [
    { databaseId: 101, name: 'no-timestamps', created_at: null, run_started_at: null },
    { databaseId: 102, name: 'partial', created_at: '2025-01-01T00:00:00Z', run_started_at: null },
  ];
  assert.equal(computeQueueLatency(runs).length, 0);
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

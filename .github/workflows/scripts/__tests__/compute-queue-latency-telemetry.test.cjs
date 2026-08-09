/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const { computeQueueLatencyTelemetry } = require('../compute-queue-latency-telemetry.cjs');

// ── Empty / no-data cases ─────────────────────────────────────────

test('returns empty percentiles for no runs', () => {
  const result = computeQueueLatencyTelemetry([]);
  assert.equal(result.percentiles, null);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.exceedsThreshold, false);
  assert.deepEqual(result.queueTimes, []);
});

test('returns empty percentiles for runs without timingSummary', () => {
  const runs = [{ name: 'test', status: 'success' }];
  const result = computeQueueLatencyTelemetry(runs);
  assert.equal(result.percentiles, null);
  assert.equal(result.sampleCount, 0);
});

test('ignores jobs with missing queueSec', () => {
  const runs = [{
    timingSummary: {
      jobs: [{ name: 'j1', queueSec: null }, { name: 'j2' }],
    },
  }];
  const result = computeQueueLatencyTelemetry(runs);
  assert.equal(result.sampleCount, 0);
});

test('ignores negative queueSec', () => {
  const runs = [{
    timingSummary: {
      jobs: [{ name: 'j1', queueSec: -5 }],
    },
  }];
  const result = computeQueueLatencyTelemetry(runs);
  assert.equal(result.sampleCount, 0);
});

// ── Percentile computation ─────────────────────────────────────────

test('computes percentiles from single job', () => {
  const runs = [{
    timingSummary: {
      jobs: [{ name: 'j1', queueSec: 100 }],
    },
  }];
  const result = computeQueueLatencyTelemetry(runs);
  assert.equal(result.sampleCount, 1);
  assert.equal(result.percentiles.p50, 100);
  assert.equal(result.percentiles.max, 100);
  assert.equal(result.exceedsThreshold, false);
});

test('computes percentiles across multiple runs and jobs', () => {
  const runs = [
    { timingSummary: { jobs: [{ queueSec: 10 }, { queueSec: 50 }] } },
    { timingSummary: { jobs: [{ queueSec: 200 }, { queueSec: 500 }] } },
    { timingSummary: { jobs: [{ queueSec: 800 }] } },
  ];
  const result = computeQueueLatencyTelemetry(runs);
  assert.equal(result.sampleCount, 5);
  assert.equal(result.percentiles.min, undefined); // no min exported
  assert.equal(result.percentiles.max, 800);
  // sorted: [10, 50, 200, 500, 800]
  // p50 = index 2 = 200
  assert.equal(result.percentiles.p50, 200);
});

test('exceedsThreshold true when p95 > 300', () => {
  // 20 jobs, p95 will be high
  const queueSecs = Array.from({ length: 20 }, (_, i) => (i + 1) * 50);
  const runs = queueSecs.map(q => ({
    timingSummary: { jobs: [{ queueSec: q }] },
  }));
  const result = computeQueueLatencyTelemetry(runs);
  assert.equal(result.sampleCount, 20);
  assert.ok(result.percentiles.p95 > 300);
  assert.equal(result.exceedsThreshold, true);
});

test('exceedsThreshold false when p95 <= 300', () => {
  const queueSecs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const runs = queueSecs.map(q => ({
    timingSummary: { jobs: [{ queueSec: q }] },
  }));
  const result = computeQueueLatencyTelemetry(runs);
  assert.equal(result.exceedsThreshold, false);
  assert.ok(result.percentiles.p95 <= 300);
});

test('custom p95Threshold is respected', () => {
  const queueSecs = [100, 200, 300, 400];
  const runs = queueSecs.map(q => ({
    timingSummary: { jobs: [{ queueSec: q }] },
  }));
  const result = computeQueueLatencyTelemetry(runs, { p95Threshold: 500 });
  assert.equal(result.threshold, 500);
  // p95 of [100,200,300,400] = 300 + 0.95*(400-300) = 395
  assert.ok(result.percentiles.p95 < 500);
  assert.equal(result.exceedsThreshold, false);
});

test('threshold is included in result', () => {
  const result = computeQueueLatencyTelemetry([]);
  assert.equal(result.threshold, 300);
});

// ── Scale boundary: pathological burst (1000+ runs) ─────────────

test('handles 1000+ sample burst without overflow or sort errors', () => {
  const N = 1500;
  const queueSecs = Array.from({ length: N }, (_, i) => i + 1);
  const runs = queueSecs.map(q => ({
    timingSummary: { jobs: [{ queueSec: q }] },
  }));
  const result = computeQueueLatencyTelemetry(runs);
  assert.equal(result.sampleCount, N);
  assert.equal(result.percentiles.min, undefined);
  assert.equal(result.percentiles.max, N);
  // sorted: [1, 2, ..., 1500]
  // p50 = index 750 → 751
  assert.equal(result.percentiles.p50, 751);
  // p99 should be near the top
  assert.ok(result.percentiles.p99 > N * 0.98);
  // p95 should be near the top
  assert.ok(result.percentiles.p95 > N * 0.94);
  // With these values, p95 will be > 300
  assert.equal(result.exceedsThreshold, true);
  // Verify queueTimes array is populated and sorted
  assert.equal(result.queueTimes.length, N);
  assert.equal(result.queueTimes[0], 1);
  assert.equal(result.queueTimes[N - 1], N);
});

test('handles 1000+ samples with many duplicate queueSec values', () => {
  const N = 1200;
  // Only 10 distinct values, repeated 120 times each
  const distinct = [10, 20, 50, 100, 200, 300, 400, 500, 800, 1000];
  const queueSecs = [];
  for (const v of distinct) {
    for (let i = 0; i < N / distinct.length; i++) queueSecs.push(v);
  }
  const runs = queueSecs.map(q => ({
    timingSummary: { jobs: [{ queueSec: q }] },
  }));
  const result = computeQueueLatencyTelemetry(runs);
  assert.equal(result.sampleCount, N);
  assert.equal(result.percentiles.max, 1000);
  assert.ok(result.percentiles.p50 >= 200 && result.percentiles.p50 <= 300);
  assert.ok(result.exceedsThreshold);
});

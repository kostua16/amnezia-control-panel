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

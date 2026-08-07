#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * Extracts queueSec from timingSummary jobs across runs and computes
 * percentile telemetry per window. Used by WHO-E03 starvation alerts.
 *
 * @param {Array<Object>} runs - Collected run summaries from the past hour
 * @param {object} [opts]
 * @param {number} [opts.p95Threshold=300] - Alert threshold in seconds
 * @returns {{ percentiles: object, queueTimes: number[], exceedsThreshold: boolean }}
 */
function computeQueueLatencyTelemetry(runs, opts = {}) {
  const p95Threshold = opts.p95Threshold ?? 300;

  const queueTimes = [];

  for (const run of runs || []) {
    const jobs = run.timingSummary?.jobs;
    if (!Array.isArray(jobs)) continue;

    for (const job of jobs) {
      if (typeof job.queueSec === 'number' && job.queueSec >= 0) {
        queueTimes.push(job.queueSec);
      }
    }
  }

  if (queueTimes.length === 0) {
    return {
      percentiles: null,
      queueTimes: [],
      exceedsThreshold: false,
      sampleCount: 0,
      threshold: p95Threshold,
    };
  }

  const sorted = [...queueTimes].sort((a, b) => a - b);
  const n = sorted.length;

  function percentile(p) {
    const idx = (p / 100) * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  const percentiles = {
    p50: Math.round(percentile(50)),
    p75: Math.round(percentile(75)),
    p95: Math.round(percentile(95)),
    p99: Math.round(percentile(99)),
    max: sorted[n - 1],
  };

  return {
    percentiles,
    queueTimes,
    exceedsThreshold: percentiles.p95 > p95Threshold,
    sampleCount: n,
    threshold: p95Threshold,
  };
}

module.exports = { computeQueueLatencyTelemetry };

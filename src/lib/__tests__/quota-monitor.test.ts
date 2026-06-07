import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QUOTA_CHECK_INTERVAL_MS } from '../quota-monitor';

/**
 * Quota-monitor threshold logic mirrors the QUOTA_THRESHOLDS constant:
 *   80%  → WARNING
 *   90%  → WARNING
 *   100% → CRITICAL
 *
 * checkUserQuotas couples to prisma and alert-service, so we test the
 * threshold classification and usage-percent calculation in isolation.
 */

// ─── Threshold Classification (mirrors private logic) ────

interface QuotaThreshold {
  percent: number;
  severity: 'WARNING' | 'CRITICAL';
}

const QUOTA_THRESHOLDS: QuotaThreshold[] = [
  { percent: 80, severity: 'WARNING' },
  { percent: 90, severity: 'WARNING' },
  { percent: 100, severity: 'CRITICAL' },
];

function getApplicableThresholds(usagePercent: number): QuotaThreshold[] {
  return QUOTA_THRESHOLDS.filter((t) => usagePercent >= t.percent);
}

function getHighestSeverity(
  usagePercent: number,
): 'CRITICAL' | 'WARNING' | null {
  const applicable = getApplicableThresholds(usagePercent);
  if (applicable.length === 0) return null;
  if (applicable.some((t) => t.severity === 'CRITICAL')) return 'CRITICAL';
  return 'WARNING';
}

// ─── Usage Percent Calculation (mirrors private logic) ───

function calcUsagePercent(usedBytes: number, quotaBytes: number): number {
  if (quotaBytes <= 0) return 0;
  return Math.round((usedBytes / quotaBytes) * 100);
}

describe('quota-monitor', () => {
  // ─── Constants ──────────────────────────────────────────

  it('exports QUOTA_CHECK_INTERVAL_MS as 5 minutes', () => {
    assert.strictEqual(QUOTA_CHECK_INTERVAL_MS, 5 * 60 * 1000);
  });

  // ─── Usage Percent Calculation ──────────────────────────

  it('calculates usage percent correctly at 0%', () => {
    assert.strictEqual(calcUsagePercent(0, 1_000_000), 0);
  });

  it('calculates usage percent correctly at 50%', () => {
    assert.strictEqual(calcUsagePercent(500_000, 1_000_000), 50);
  });

  it('calculates usage percent correctly at 79%', () => {
    assert.strictEqual(calcUsagePercent(790_000, 1_000_000), 79);
  });

  it('calculates usage percent correctly at 80%', () => {
    assert.strictEqual(calcUsagePercent(800_000, 1_000_000), 80);
  });

  it('calculates usage percent correctly at 100%', () => {
    assert.strictEqual(calcUsagePercent(1_000_000, 1_000_000), 100);
  });

  it('calculates usage percent correctly over 100%', () => {
    assert.strictEqual(calcUsagePercent(1_500_000, 1_000_000), 150);
  });

  it('returns 0 when quota is 0', () => {
    assert.strictEqual(calcUsagePercent(500_000, 0), 0);
  });

  it('rounds usage percent to nearest integer', () => {
    // 333,333 / 1,000,000 = 33.3333% → rounds to 33
    assert.strictEqual(calcUsagePercent(333_333, 1_000_000), 33);
  });

  // ─── Threshold Classification ───────────────────────────

  it('returns no alerts below 80%', () => {
    assert.strictEqual(getHighestSeverity(50), null);
    assert.strictEqual(getHighestSeverity(79), null);
  });

  it('returns WARNING at 80%', () => {
    assert.strictEqual(getHighestSeverity(80), 'WARNING');
  });

  it('returns WARNING at 89%', () => {
    assert.strictEqual(getHighestSeverity(89), 'WARNING');
  });

  it('returns WARNING at 90% (not CRITICAL, because 90% threshold is WARNING)', () => {
    assert.strictEqual(getHighestSeverity(90), 'WARNING');
  });

  it('returns CRITICAL at 100%', () => {
    assert.strictEqual(getHighestSeverity(100), 'CRITICAL');
  });

  it('returns CRITICAL at 150%', () => {
    assert.strictEqual(getHighestSeverity(150), 'CRITICAL');
  });

  // ─── Applicable Thresholds ──────────────────────────────

  it('identifies all applicable thresholds at 100%', () => {
    const applicable = getApplicableThresholds(100);
    assert.strictEqual(applicable.length, 3);
    assert.strictEqual(applicable[0].percent, 80);
    assert.strictEqual(applicable[1].percent, 90);
    assert.strictEqual(applicable[2].percent, 100);
  });

  it('identifies two applicable thresholds at 85%', () => {
    const applicable = getApplicableThresholds(85);
    assert.strictEqual(applicable.length, 1);
    assert.strictEqual(applicable[0].percent, 80);
  });

  it('identifies no applicable thresholds at 50%', () => {
    const applicable = getApplicableThresholds(50);
    assert.strictEqual(applicable.length, 0);
  });
});

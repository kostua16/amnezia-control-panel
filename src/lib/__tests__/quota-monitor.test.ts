import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUOTA_CHECK_INTERVAL_MS,
  QUOTA_THRESHOLDS,
  classifyQuotaSeverity,
} from '../quota-monitor';

describe('quota-monitor constants', () => {
  it('exports QUOTA_CHECK_INTERVAL_MS as 5 minutes', () => {
    assert.strictEqual(QUOTA_CHECK_INTERVAL_MS, 5 * 60 * 1000);
  });

  it('exports three threshold levels', () => {
    assert.strictEqual(QUOTA_THRESHOLDS.length, 3);
  });

  it('thresholds are ordered by percent ascending', () => {
    for (let i = 1; i < QUOTA_THRESHOLDS.length; i++) {
      assert.ok(
        QUOTA_THRESHOLDS[i].percent > QUOTA_THRESHOLDS[i - 1].percent,
        `Threshold ${i} (${QUOTA_THRESHOLDS[i].percent}) must be > threshold ${i - 1} (${QUOTA_THRESHOLDS[i - 1].percent})`,
      );
    }
  });

  it('final threshold at 100% is CRITICAL', () => {
    const last = QUOTA_THRESHOLDS[QUOTA_THRESHOLDS.length - 1];
    assert.strictEqual(last.percent, 100);
    assert.strictEqual(last.severity, 'CRITICAL');
  });
});

describe('classifyQuotaSeverity', () => {
  it('returns null for 0% usage', () => {
    assert.strictEqual(classifyQuotaSeverity(0), null);
  });

  it('returns null below 80%', () => {
    assert.strictEqual(classifyQuotaSeverity(79), null);
  });

  it('returns WARNING at exactly 80%', () => {
    assert.strictEqual(classifyQuotaSeverity(80), 'WARNING');
  });

  it('returns WARNING between 80 and 89', () => {
    assert.strictEqual(classifyQuotaSeverity(85), 'WARNING');
  });

  it('returns WARNING at exactly 90% (highest matching is 90-WARNING)', () => {
    assert.strictEqual(classifyQuotaSeverity(90), 'WARNING');
  });

  it('returns WARNING between 90 and 99', () => {
    assert.strictEqual(classifyQuotaSeverity(95), 'WARNING');
  });

  it('returns CRITICAL at exactly 100%', () => {
    assert.strictEqual(classifyQuotaSeverity(100), 'CRITICAL');
  });

  it('returns CRITICAL above 100%', () => {
    assert.strictEqual(classifyQuotaSeverity(150), 'CRITICAL');
  });

  it('picks the highest matching threshold severity', () => {
    // At 99%: 80-WARNING matches, 90-WARNING matches, 100-CRITICAL does not
    // Result should be WARNING (highest matching)
    assert.strictEqual(classifyQuotaSeverity(99), 'WARNING');

    // At 100%: all three match, highest is CRITICAL
    assert.strictEqual(classifyQuotaSeverity(100), 'CRITICAL');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUOTA_CHECK_INTERVAL_MS,
  QUOTA_THRESHOLDS,
  getExceededQuotaThresholds,
} from '../quota-monitor';

describe('quota-monitor', () => {
  describe('constants', () => {
    it('exports QUOTA_CHECK_INTERVAL_MS as 5 minutes', () => {
      assert.strictEqual(QUOTA_CHECK_INTERVAL_MS, 5 * 60 * 1000);
    });

    it('has 3 thresholds in ascending percent order', () => {
      assert.strictEqual(QUOTA_THRESHOLDS.length, 3);
      for (let i = 1; i < QUOTA_THRESHOLDS.length; i++) {
        assert.ok(
          QUOTA_THRESHOLDS[i].percent > QUOTA_THRESHOLDS[i - 1].percent,
          'Thresholds must be ascending',
        );
      }
    });

    it('uses WARNING for 80% and 90%, CRITICAL for 100%', () => {
      assert.strictEqual(QUOTA_THRESHOLDS[0].severity, 'WARNING');
      assert.strictEqual(QUOTA_THRESHOLDS[1].severity, 'WARNING');
      assert.strictEqual(QUOTA_THRESHOLDS[2].severity, 'CRITICAL');
    });
  });

  describe('getExceededQuotaThresholds', () => {
    it('returns empty array when usage is below all thresholds', () => {
      assert.deepEqual(getExceededQuotaThresholds(0), []);
      assert.deepEqual(getExceededQuotaThresholds(50), []);
      assert.deepEqual(getExceededQuotaThresholds(79), []);
    });

    it('returns 80% WARNING when at exactly 80%', () => {
      const result = getExceededQuotaThresholds(80);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].percent, 80);
      assert.strictEqual(result[0].severity, 'WARNING');
    });

    it('returns two thresholds at 90%', () => {
      const result = getExceededQuotaThresholds(90);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].percent, 80);
      assert.strictEqual(result[1].percent, 90);
    });

    it('returns all three thresholds at 100%', () => {
      const result = getExceededQuotaThresholds(100);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[2].percent, 100);
      assert.strictEqual(result[2].severity, 'CRITICAL');
    });

    it('returns all three thresholds above 100%', () => {
      const result = getExceededQuotaThresholds(150);
      assert.strictEqual(result.length, 3);
    });
  });
});

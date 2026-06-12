import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getUsageColor, getUsageTextColor } from '../usage-colors';

describe('usage-colors', () => {
  describe('getUsageColor', () => {
    it('returns green for low usage', () => {
      assert.strictEqual(getUsageColor(0), 'bg-green-500');
      assert.strictEqual(getUsageColor(50), 'bg-green-500');
      assert.strictEqual(getUsageColor(69), 'bg-green-500');
    });

    it('returns yellow for medium usage (70-89)', () => {
      assert.strictEqual(getUsageColor(70), 'bg-yellow-500');
      assert.strictEqual(getUsageColor(80), 'bg-yellow-500');
      assert.strictEqual(getUsageColor(89), 'bg-yellow-500');
    });

    it('returns red for critical usage (90+)', () => {
      assert.strictEqual(getUsageColor(90), 'bg-red-500');
      assert.strictEqual(getUsageColor(100), 'bg-red-500');
    });
  });

  describe('getUsageTextColor', () => {
    it('returns green text for low usage', () => {
      assert.strictEqual(getUsageTextColor(0), 'text-green-500');
      assert.strictEqual(getUsageTextColor(69), 'text-green-500');
    });

    it('returns yellow text for medium usage (70-89)', () => {
      assert.strictEqual(getUsageTextColor(70), 'text-yellow-500');
      assert.strictEqual(getUsageTextColor(89), 'text-yellow-500');
    });

    it('returns red text for critical usage (90+)', () => {
      assert.strictEqual(getUsageTextColor(90), 'text-red-500');
      assert.strictEqual(getUsageTextColor(100), 'text-red-500');
    });
  });
});

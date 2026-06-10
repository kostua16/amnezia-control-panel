import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from '../format';

describe('formatBytes', () => {
  it('returns "0 B" for zero', () => {
    assert.strictEqual(formatBytes(0), '0 B');
  });

  it('formats bytes correctly', () => {
    assert.strictEqual(formatBytes(512), '512 B');
  });

  it('formats kilobytes with one decimal', () => {
    assert.strictEqual(formatBytes(1024), '1.0 KB');
    assert.strictEqual(formatBytes(1536), '1.5 KB');
  });

  it('formats megabytes', () => {
    assert.strictEqual(formatBytes(1048576), '1.0 MB');
  });

  it('formats gigabytes', () => {
    assert.strictEqual(formatBytes(1073741824), '1.0 GB');
  });

  it('formats terabytes', () => {
    assert.strictEqual(formatBytes(1099511627776), '1.0 TB');
  });

  it('clamps to TB unit for very large values', () => {
    const result = formatBytes(1099511627776 * 5);
    assert.ok(result.endsWith('TB'), `Expected TB unit, got: ${result}`);
  });

  it('returns "0 B" for negative input', () => {
    assert.strictEqual(formatBytes(-100), '0 B');
  });

  it('returns "0 B" for NaN', () => {
    assert.strictEqual(formatBytes(NaN), '0 B');
  });

  it('returns "0 B" for Infinity', () => {
    assert.strictEqual(formatBytes(Infinity), '0 B');
  });

  it('handles fractional bytes without an undefined unit', () => {
    const result = formatBytes(0.5);
    assert.ok(result.endsWith(' B'), `Expected B unit, got: ${result}`);
    assert.ok(!result.includes('undefined'), `Got undefined in: ${result}`);
  });

  it('handles very small positive bytes', () => {
    const result = formatBytes(0.001);
    assert.ok(result.endsWith(' B'), `Expected B unit, got: ${result}`);
    assert.ok(!result.includes('undefined'), `Got undefined in: ${result}`);
  });
});

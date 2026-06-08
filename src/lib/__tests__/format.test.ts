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

  it('returns "0 B" for -0', () => {
    assert.strictEqual(formatBytes(-0), '0 B');
  });

  it('returns "0 B" for negative zero', () => {
    assert.strictEqual(Object.is(formatBytes(-0), '0 B'), true);
  });

  it('handles boundary just below 1 KB (1023 bytes)', () => {
    assert.strictEqual(formatBytes(1023), '1023 B');
  });

  it('handles fractional values just above 1 KB', () => {
    const result = formatBytes(1025);
    assert.ok(result.startsWith('1.0'), `Expected ~1.0 KB, got: ${result}`);
    assert.ok(result.endsWith('KB'), `Expected KB unit, got: ${result}`);
  });
});

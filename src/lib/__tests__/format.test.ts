import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from '../format';

describe('formatBytes', () => {
  it('returns "0 B" for zero', () => {
    assert.equal(formatBytes(0), '0 B');
  });

  it('formats bytes correctly', () => {
    assert.equal(formatBytes(512), '512 B');
  });

  it('formats kilobytes with one decimal', () => {
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
  });

  it('formats megabytes', () => {
    assert.equal(formatBytes(1048576), '1.0 MB');
  });

  it('formats gigabytes', () => {
    assert.equal(formatBytes(1073741824), '1.0 GB');
  });

  it('formats terabytes', () => {
    assert.equal(formatBytes(1099511627776), '1.0 TB');
  });

  it('clamps to TB unit for very large values', () => {
    const result = formatBytes(1099511627776 * 5);
    assert.ok(result.endsWith('TB'), `Expected TB unit, got: ${result}`);
  });

  it('returns "0 B" for negative input', () => {
    assert.equal(formatBytes(-100), '0 B');
  });

  it('returns "0 B" for NaN', () => {
    assert.equal(formatBytes(NaN), '0 B');
  });

  it('returns "0 B" for Infinity', () => {
    assert.equal(formatBytes(Infinity), '0 B');
  });
});

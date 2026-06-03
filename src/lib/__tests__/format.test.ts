import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from '../format';

describe('formatBytes', () => {
  it('returns "0 B" for zero', () => {
    assert.strictEqual(formatBytes(0), '0 B');
  });

  it('formats bytes under 1 KB', () => {
    assert.strictEqual(formatBytes(512), '512 B');
  });

  it('formats kilobytes with one decimal', () => {
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

  it('rounds to one decimal for units above B', () => {
    const result = formatBytes(1536);
    assert.ok(result.includes('.'));
  });
});

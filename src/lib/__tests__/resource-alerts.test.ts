import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCE_CHECK_INTERVAL_MS,
  classifyResourceSeverity,
} from '../resource-alerts';

describe('resource-alerts constants', () => {
  it('exports RESOURCE_CHECK_INTERVAL_MS as 60 seconds', () => {
    assert.strictEqual(RESOURCE_CHECK_INTERVAL_MS, 60_000);
  });
});

describe('classifyResourceSeverity', () => {
  it('returns CRITICAL for CPU at 95% (above critical threshold 90)', () => {
    const result = classifyResourceSeverity('cpu', 95);
    assert.strictEqual(result.severity, 'CRITICAL');
    assert.strictEqual(result.label, 'CPU');
  });

  it('returns CRITICAL for CPU at exactly 90% (critical threshold)', () => {
    const result = classifyResourceSeverity('cpu', 90);
    assert.strictEqual(result.severity, 'CRITICAL');
  });

  it('returns WARNING for CPU at 85% (between warning and critical)', () => {
    const result = classifyResourceSeverity('cpu', 85);
    assert.strictEqual(result.severity, 'WARNING');
    assert.strictEqual(result.label, 'CPU');
  });

  it('returns WARNING for CPU at exactly 80% (warning threshold)', () => {
    const result = classifyResourceSeverity('cpu', 80);
    assert.strictEqual(result.severity, 'WARNING');
  });

  it('returns null for CPU at 79% (below warning)', () => {
    const result = classifyResourceSeverity('cpu', 79);
    assert.strictEqual(result.severity, null);
  });

  it('returns null for CPU at 0% (healthy)', () => {
    const result = classifyResourceSeverity('cpu', 0);
    assert.strictEqual(result.severity, null);
  });

  it('returns CRITICAL for memory at 92% (above critical threshold 90)', () => {
    const result = classifyResourceSeverity('memory', 92);
    assert.strictEqual(result.severity, 'CRITICAL');
    assert.strictEqual(result.label, 'RAM');
  });

  it('returns WARNING for memory at 85% (between warning and critical)', () => {
    const result = classifyResourceSeverity('memory', 85);
    assert.strictEqual(result.severity, 'WARNING');
  });

  it('returns null for memory at 70% (below warning)', () => {
    const result = classifyResourceSeverity('memory', 70);
    assert.strictEqual(result.severity, null);
  });

  it('returns CRITICAL for disk at 96% (above critical threshold 95)', () => {
    const result = classifyResourceSeverity('disk', 96);
    assert.strictEqual(result.severity, 'CRITICAL');
    assert.strictEqual(result.label, 'Disk');
  });

  it('returns WARNING for disk at 92% (between warning 90 and critical 95)', () => {
    const result = classifyResourceSeverity('disk', 92);
    assert.strictEqual(result.severity, 'WARNING');
  });

  it('returns null for disk at 89% (below warning threshold 90)', () => {
    const result = classifyResourceSeverity('disk', 89);
    assert.strictEqual(result.severity, null);
  });

  it('returns null severity for unknown metric', () => {
    const result = classifyResourceSeverity('unknown_metric', 99);
    assert.strictEqual(result.severity, null);
    assert.strictEqual(result.label, 'unknown_metric');
  });

  it('CPU uses lower thresholds (80/90) than disk (90/95)', () => {
    // CPU at 85% is WARNING, disk at 85% is normal
    assert.strictEqual(classifyResourceSeverity('cpu', 85).severity, 'WARNING');
    assert.strictEqual(classifyResourceSeverity('disk', 85).severity, null);
  });
});

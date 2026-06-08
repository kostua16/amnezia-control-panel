import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCE_CHECK_INTERVAL_MS,
  classifyResourceSeverity,
} from '../resource-alerts';

describe('resource-alerts', () => {
  it('exports RESOURCE_CHECK_INTERVAL_MS as 60 seconds', () => {
    assert.strictEqual(RESOURCE_CHECK_INTERVAL_MS, 60_000);
  });
});

describe('classifyResourceSeverity', () => {
  it('returns null when value is below warning threshold', () => {
    assert.strictEqual(classifyResourceSeverity(50, 80, 90), null);
  });

  it('returns null when value is just below warning threshold', () => {
    assert.strictEqual(classifyResourceSeverity(79, 80, 90), null);
  });

  it('returns WARNING when value equals warning threshold', () => {
    assert.strictEqual(classifyResourceSeverity(80, 80, 90), 'WARNING');
  });

  it('returns WARNING when value is between warning and critical', () => {
    assert.strictEqual(classifyResourceSeverity(85, 80, 90), 'WARNING');
  });

  it('returns WARNING when value is just below critical threshold', () => {
    assert.strictEqual(classifyResourceSeverity(89, 80, 90), 'WARNING');
  });

  it('returns CRITICAL when value equals critical threshold', () => {
    assert.strictEqual(classifyResourceSeverity(90, 80, 90), 'CRITICAL');
  });

  it('returns CRITICAL when value exceeds critical threshold', () => {
    assert.strictEqual(classifyResourceSeverity(99, 80, 90), 'CRITICAL');
  });

  it('returns CRITICAL at 100 percent', () => {
    assert.strictEqual(classifyResourceSeverity(100, 80, 90), 'CRITICAL');
  });

  it('returns null at zero percent', () => {
    assert.strictEqual(classifyResourceSeverity(0, 80, 90), null);
  });

  it('uses CPU thresholds: WARNING at 80, CRITICAL at 90', () => {
    assert.strictEqual(classifyResourceSeverity(79, 80, 90), null);
    assert.strictEqual(classifyResourceSeverity(80, 80, 90), 'WARNING');
    assert.strictEqual(classifyResourceSeverity(89, 80, 90), 'WARNING');
    assert.strictEqual(classifyResourceSeverity(90, 80, 90), 'CRITICAL');
  });

  it('uses disk thresholds: WARNING at 90, CRITICAL at 95', () => {
    assert.strictEqual(classifyResourceSeverity(89, 90, 95), null);
    assert.strictEqual(classifyResourceSeverity(90, 90, 95), 'WARNING');
    assert.strictEqual(classifyResourceSeverity(94, 90, 95), 'WARNING');
    assert.strictEqual(classifyResourceSeverity(95, 90, 95), 'CRITICAL');
  });
});

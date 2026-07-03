/**
 * Unit tests for rule-enforcement.ts pure function enforceXrayRules.
 *
 * Run: node --import tsx src/lib/__tests__/rule-enforcement.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enforceXrayRules } from '../rule-enforcement';
import type { XrayRoutingRule } from '@/types/chain';

// ─── Helpers ─────────────────────────────────────────────

function makeRule(
  overrides: Partial<XrayRoutingRule> & Pick<XrayRoutingRule, 'nodeId'>,
): XrayRoutingRule {
  return {
    type: 'ip',
    value: '10.0.0.0/24',
    outboundTag: 'direct',
    priority: 10,
    ...overrides,
  };
}

// ─── enforceXrayRules ────────────────────────────────────

describe('enforceXrayRules', () => {
  it('returns allowed=false when no rules match', () => {
    const result = enforceXrayRules('192.168.1.1', []);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.matchedRule, undefined);
    assert.ok(result.reason?.includes('No matching'));
  });

  it('matches when destIp falls within the CIDR range', () => {
    const rule = makeRule({ nodeId: 'node-1', value: '10.0.0.0/24' });
    const result = enforceXrayRules('10.0.0.5', [rule]);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.matchedRule, 'node-1');
  });

  it('does NOT false-positive on string prefix overlap (CIDR /24 boundary)', () => {
    // 192.168.10.0 must NOT match 192.168.1.0/24 (original startsWith bug)
    const rule = makeRule({ nodeId: 'node-b', value: '192.168.1.0/24' });
    assert.strictEqual(enforceXrayRules('192.168.10.0', [rule]).allowed, false);
  });

  it('does not match when IP string prefix differs', () => {
    const rule = makeRule({ nodeId: 'node-2', value: '10.0.0.5/32' });
    const result = enforceXrayRules('192.168.1.1', [rule]);
    assert.strictEqual(result.allowed, false);
  });

  it('ignores domain-type rules for IP matching', () => {
    const rule = makeRule({
      nodeId: 'node-3',
      type: 'domain',
      value: 'example.com',
    });
    const result = enforceXrayRules('example.com', [rule]);
    assert.strictEqual(result.allowed, false);
  });

  it('returns the first matching rule', () => {
    const rule1 = makeRule({ nodeId: 'first', value: '10.0.0.5/32' });
    const rule2 = makeRule({ nodeId: 'second', value: '10.0.0.5/32' });
    const result = enforceXrayRules('10.0.0.5', [rule1, rule2]);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.matchedRule, 'first');
  });

  it('matches single IP without CIDR notation', () => {
    const rule = makeRule({ nodeId: 'node-4', value: '1.2.3.4/32' });
    const result = enforceXrayRules('1.2.3.4', [rule]);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.matchedRule, 'node-4');
  });
});

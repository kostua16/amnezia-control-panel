import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesCIDR } from '@/lib/cidr-match';

describe('matchesCIDR', () => {
  it('matches an IP within a /24', () => {
    assert.strictEqual(matchesCIDR('192.168.1.50', '192.168.1.0/24'), true);
  });

  it('rejects an IP outside a /24', () => {
    assert.strictEqual(matchesCIDR('192.168.10.1', '192.168.1.0/24'), false);
  });

  it('matches an IP within a /8', () => {
    assert.strictEqual(matchesCIDR('10.1.2.3', '10.0.0.0/8'), true);
  });

  it('matches an IP within a /16', () => {
    assert.strictEqual(matchesCIDR('172.16.5.1', '172.16.0.0/16'), true);
  });

  it('rejects an IP outside a /16', () => {
    assert.strictEqual(matchesCIDR('172.17.0.1', '172.16.0.0/16'), false);
  });

  it('handles /32 as exact match', () => {
    assert.strictEqual(matchesCIDR('10.0.0.1', '10.0.0.1/32'), true);
    assert.strictEqual(matchesCIDR('10.0.0.2', '10.0.0.1/32'), false);
  });

  it('handles /0 as match-all', () => {
    assert.strictEqual(matchesCIDR('255.255.255.255', '0.0.0.0/0'), true);
    assert.strictEqual(matchesCIDR('1.2.3.4', '0.0.0.0/0'), true);
  });

  it('returns false for malformed CIDR (no slash)', () => {
    assert.strictEqual(matchesCIDR('10.0.0.1', '10.0.0.0'), false);
  });

  it('returns false for invalid prefix length', () => {
    assert.strictEqual(matchesCIDR('10.0.0.1', '10.0.0.0/33'), false);
    assert.strictEqual(matchesCIDR('10.0.0.1', '10.0.0.0/-1'), false);
  });

  it('returns false for malformed IP', () => {
    assert.strictEqual(matchesCIDR('not-an-ip', '10.0.0.0/8'), false);
    assert.strictEqual(matchesCIDR('10.0.0', '10.0.0.0/8'), false);
  });

  // Regression: the original bug cases from proposal #26
  it('does NOT false-positive 192.168.10.0 for 192.168.1.0/24', () => {
    assert.strictEqual(matchesCIDR('192.168.10.0', '192.168.1.0/24'), false);
  });

  it('DOES match 10.1.2.3 for 10.0.0.0/8', () => {
    assert.strictEqual(matchesCIDR('10.1.2.3', '10.0.0.0/8'), true);
  });
});

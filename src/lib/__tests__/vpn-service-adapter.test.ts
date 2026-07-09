import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAdapter,
  AwgAdapter,
  ThreeXuiAdapter,
} from '../vpn-service-adapter';

/**
 * Coverage for the VPN service adapter registry.
 *
 * getAdapter() is the single dispatch point replacing all if/else chains on
 * serviceType. These tests verify that the registry returns the correct adapter
 * type for known service types and throws for unknown ones.
 */

describe('vpn-service-adapter: getAdapter registry', () => {
  it('returns an AwgAdapter for serviceType "AWG"', () => {
    const adapter = getAdapter('AWG');
    assert.ok(adapter instanceof AwgAdapter, 'AWG should return AwgAdapter');
  });

  it('returns a ThreeXuiAdapter for serviceType "THREE_XUI"', () => {
    const adapter = getAdapter('THREE_XUI');
    assert.ok(
      adapter instanceof ThreeXuiAdapter,
      'THREE_XUI should return ThreeXuiAdapter',
    );
  });

  it('throws for an unknown service type', () => {
    assert.throws(
      () => getAdapter('UNKNOWN_TYPE'),
      /Unknown VPN service type/i,
      'Unknown service type must throw',
    );
  });

  it('adapter instances expose all four lifecycle methods', () => {
    const adapter = getAdapter('AWG');
    assert.equal(typeof adapter.create, 'function');
    assert.equal(typeof adapter.delete, 'function');
    assert.equal(typeof adapter.block, 'function');
    assert.equal(typeof adapter.unblock, 'function');
  });

  it('AWG adapter delegates to vpn-services create which rejects invalid usernames', async () => {
    const adapter = getAdapter('AWG');
    const result = await adapter.create('bad name');
    assert.equal(result.success, false, 'Invalid username must fail');
    assert.match(result.message, /invalid characters/i);
  });

  it('THREE_XUI adapter delegates to vpn-services block which rejects invalid usernames', async () => {
    const adapter = getAdapter('THREE_XUI');
    const result = await adapter.block('bad/name');
    assert.equal(result.success, false, 'Invalid username must fail');
    assert.match(result.message, /invalid characters/i);
  });

  it('returns same instance for repeated calls (registry is stable)', () => {
    const a = getAdapter('AWG');
    const b = getAdapter('AWG');
    assert.strictEqual(a, b, 'Registry should return the same singleton');
  });
});

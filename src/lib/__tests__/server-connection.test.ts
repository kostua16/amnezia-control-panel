import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearStaleConnections,
  getCachedStatus,
  invalidateConnection,
  testConnection,
} from '../server-connection';
import type { Server } from '@/types/server';

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: 1,
    name: 'Test Server',
    hostname: 'example.com',
    port: 22,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('server-connection pool management', () => {
  beforeEach(() => {
    clearStaleConnections();
    invalidateConnection(1);
    invalidateConnection(42);
    invalidateConnection(99999);
  });

  it('returns null for an unknown server', () => {
    assert.strictEqual(getCachedStatus(99999), null);
  });

  it('returns null for server id 0', () => {
    assert.strictEqual(getCachedStatus(0), null);
  });

  it('returns null for negative server id', () => {
    assert.strictEqual(getCachedStatus(-1), null);
  });

  it('does not throw for an unknown server', () => {
    assert.doesNotThrow(() => invalidateConnection(99999));
  });

  it('double invalidation is idempotent', () => {
    invalidateConnection(42);
    invalidateConnection(42);
    assert.strictEqual(getCachedStatus(42), null);
  });
});

describe('testConnection hostname validation', () => {
  it('rejects hostnames with shell metacharacters before ping', async () => {
    const result = await testConnection(
      makeServer({
        id: 321,
        hostname: 'example.com;rm -rf /',
      }),
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.latencyMs, null);
    assert.ok(result.message.includes('Invalid hostname'));
  });
});

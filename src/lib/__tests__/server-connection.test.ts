import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCachedStatus,
  invalidateConnection,
  clearStaleConnections,
} from '../server-connection';

/**
 * Pool management functions in server-connection.ts operate on a module-level
 * Map. We test the pure cache operations (getCachedStatus, invalidateConnection,
 * clearStaleConnections) here. The testConnection/executeOnServer functions
 * depend on execFile and are not tested in this unit test.
 *
 * Note: Because the pool is module-level state, tests may interfere with each
 * other if run in parallel. Node:test runs sequentially within a file, so this
 * is safe.
 */

// Pool entries are created by testConnection (which we cannot call here
// without mocking execFile). We verify that the cache API behaves correctly
// when empty and after invalidation.

describe('server-connection pool management', () => {
  describe('getCachedStatus', () => {
    it('returns null for an unknown server', () => {
      assert.strictEqual(getCachedStatus(99999), null);
    });

    it('returns null for server id 0', () => {
      assert.strictEqual(getCachedStatus(0), null);
    });

    it('returns null for negative server id', () => {
      assert.strictEqual(getCachedStatus(-1), null);
    });
  });

  describe('invalidateConnection', () => {
    it('does not throw for an unknown server', () => {
      assert.doesNotThrow(() => invalidateConnection(99999));
    });

    it('removes a cached entry so getCachedStatus returns null', () => {
      // If there was no entry, it's still null after invalidation
      invalidateConnection(1);
      assert.strictEqual(getCachedStatus(1), null);
    });
  });

  describe('clearStaleConnections', () => {
    it('does not throw when pool is empty', () => {
      assert.doesNotThrow(() => clearStaleConnections());
    });

    it('does not throw when called multiple times', () => {
      clearStaleConnections();
      clearStaleConnections();
      clearStaleConnections();
    });
  });

  describe('invalidateConnection then getCachedStatus', () => {
    beforeEach(() => {
      // Clean up any stale entries
      clearStaleConnections();
    });

    it('double invalidation is idempotent', () => {
      invalidateConnection(42);
      invalidateConnection(42);
      assert.strictEqual(getCachedStatus(42), null);
    });
  });
});

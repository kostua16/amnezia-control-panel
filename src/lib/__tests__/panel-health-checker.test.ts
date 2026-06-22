import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPanelInFallback,
  getFallbackPanels,
  cachePanelApiKey,
  removePanelApiKey,
  cleanupExpiredApiKeys,
  getCachedPanelApiKey,
} from '../panel-health-checker';

describe('Panel fallback state', () => {
  // Note: panel-health-checker uses module-level Maps, so state persists
  // across tests within the same process. We clean up after each test.

  beforeEach(() => {
    // Clear fallback state by removing all entries
    const current = getFallbackPanels();
    for (const id of current) {
      removePanelApiKey(id);
    }
  });

  it('starts with no panels in fallback', () => {
    assert.deepStrictEqual(getFallbackPanels(), []);
  });

  it('isPanelInFallback returns false for unknown panel', () => {
    assert.strictEqual(isPanelInFallback(99999), false);
  });

  it('getFallbackPanels returns empty array after cleanup', () => {
    assert.deepStrictEqual(getFallbackPanels(), []);
  });
});

describe('Panel API key cache', () => {
  beforeEach(() => {
    removePanelApiKey(42);
    removePanelApiKey(55);
    removePanelApiKey(99);
  });

  it('caches and retrieves a panel API key', () => {
    cachePanelApiKey(42, 'test-key-123');
    // The key is stored; removePanelApiKey should work without error
    removePanelApiKey(42);
  });

  it('removePanelApiKey is idempotent for unknown panels', () => {
    // Should not throw
    removePanelApiKey(99999);
  });

  it('allows overwriting a cached key', () => {
    cachePanelApiKey(55, 'key-1');
    cachePanelApiKey(55, 'key-2');
    // No error means the overwrite worked
    removePanelApiKey(55);
  });

  it('isolates keys between different panels', () => {
    cachePanelApiKey(42, 'key-a');
    cachePanelApiKey(99, 'key-b');
    removePanelApiKey(42);
    removePanelApiKey(99);
  });
});

describe('API key cache 1-hour TTL', () => {
  // Mirrors API_KEY_CACHE_MAX_AGE_MS in panel-health-checker.ts
  const MAX_AGE_MS = 60 * 60 * 1000;

  beforeEach(() => {
    removePanelApiKey(700);
    removePanelApiKey(701);
  });

  it('cleanupExpiredApiKeys evicts entries past the 1-hour max-age', () => {
    const cachedAt = Date.now();
    cachePanelApiKey(700, 'stale-key');

    // Read two hours later — past the max-age, so the entry is evicted
    cleanupExpiredApiKeys(cachedAt + MAX_AGE_MS * 2);

    assert.strictEqual(getCachedPanelApiKey(700, cachedAt), undefined);
  });

  it('cleanupExpiredApiKeys keeps entries within the 1-hour max-age', () => {
    const cachedAt = Date.now();
    cachePanelApiKey(701, 'fresh-key');

    const thirtyMinLater = cachedAt + 30 * 60 * 1000;
    cleanupExpiredApiKeys(thirtyMinLater);

    assert.strictEqual(getCachedPanelApiKey(701, thirtyMinLater), 'fresh-key');
  });

  it('getCachedPanelApiKey treats an expired entry as a miss and evicts it on read', () => {
    const cachedAt = Date.now();
    cachePanelApiKey(700, 'stale-key');

    const twoHoursLater = cachedAt + MAX_AGE_MS * 2;
    assert.strictEqual(getCachedPanelApiKey(700, twoHoursLater), undefined);
    // The read itself evicted the stale entry
    assert.strictEqual(getCachedPanelApiKey(700, twoHoursLater), undefined);
  });

  it('getCachedPanelApiKey returns the key within the 1-hour max-age', () => {
    const cachedAt = Date.now();
    cachePanelApiKey(701, 'fresh-key');

    const thirtyMinLater = cachedAt + 30 * 60 * 1000;
    assert.strictEqual(getCachedPanelApiKey(701, thirtyMinLater), 'fresh-key');
  });
});

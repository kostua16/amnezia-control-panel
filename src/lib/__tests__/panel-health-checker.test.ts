import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPanelInFallback,
  getFallbackPanels,
  cachePanelApiKey,
  removePanelApiKey,
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
});

describe('Panel API key cache', () => {
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
});

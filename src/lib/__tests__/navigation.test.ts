import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_ITEMS } from '../navigation';

describe('NAV_ITEMS', () => {
  it('has at least one navigation item', () => {
    assert.ok(NAV_ITEMS.length > 0);
  });

  it('has unique hrefs across all items', () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    assert.strictEqual(new Set(hrefs).size, hrefs.length);
  });

  it('has unique labels across all items', () => {
    const labels = NAV_ITEMS.map((item) => item.label);
    assert.strictEqual(new Set(labels).size, labels.length);
  });

  it('all hrefs start with a forward slash', () => {
    for (const item of NAV_ITEMS) {
      assert.ok(
        item.href.startsWith('/'),
        `Item "${item.label}" href does not start with /: ${item.href}`,
      );
    }
  });

  it('all items have non-empty labels', () => {
    for (const item of NAV_ITEMS) {
      assert.ok(
        item.label.length > 0,
        `Item with href "${item.href}" has an empty label`,
      );
    }
  });

  it('all items have an icon defined', () => {
    for (const item of NAV_ITEMS) {
      assert.ok(item.icon, `Item "${item.label}" is missing an icon`);
    }
  });
});

/**
 * Unit tests for config-presets.ts pure functions.
 *
 * Run: node --import tsx src/lib/__tests__/config-presets.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPresets,
  getPreset,
  getPresetsByServiceType,
  applyPreset,
} from '../config-presets';

describe('getPresets', () => {
  it('returns a non-empty array', () => {
    const presets = getPresets();
    assert.ok(Array.isArray(presets));
    assert.ok(presets.length > 0);
  });

  it('each preset has required fields', () => {
    for (const p of getPresets()) {
      assert.ok(typeof p.name === 'string' && p.name.length > 0);
      assert.ok(typeof p.label === 'string' && p.label.length > 0);
      assert.ok(typeof p.protocol === 'string');
      assert.ok(typeof p.serviceType === 'string');
      assert.ok(typeof p.settings === 'object');
      assert.ok(Array.isArray(p.tags));
    }
  });
});

describe('getPreset', () => {
  it('returns a preset by name', () => {
    const preset = getPreset('home-office');
    assert.ok(preset);
    assert.strictEqual(preset!.name, 'home-office');
    assert.strictEqual(preset!.label, 'Home Office');
  });

  it('returns undefined for unknown preset', () => {
    const preset = getPreset('nonexistent-preset');
    assert.strictEqual(preset, undefined);
  });
});

describe('getPresetsByServiceType', () => {
  it('returns only AWG presets', () => {
    const awg = getPresetsByServiceType('AWG');
    assert.ok(awg.length > 0);
    for (const p of awg) {
      assert.strictEqual(p.serviceType, 'AWG');
    }
  });

  it('returns only THREE_XUI presets', () => {
    const xui = getPresetsByServiceType('THREE_XUI');
    assert.ok(xui.length > 0);
    for (const p of xui) {
      assert.strictEqual(p.serviceType, 'THREE_XUI');
    }
  });

  it('returns empty for a service type with no presets', () => {
    const result = getPresetsByServiceType('NONEXISTENT' as never);
    assert.strictEqual(result.length, 0);
  });
});

describe('applyPreset', () => {
  it('merges preset settings onto base config', () => {
    const result = applyPreset('home-office', { customField: true });
    assert.strictEqual(result.customField, true);
    assert.strictEqual(result._preset, 'home-office');
  });

  it('preset settings override base keys', () => {
    const result = applyPreset('stealth', { mtu: 9999 });
    // stealth preset sets mtu: 1280, should override the base
    assert.strictEqual(result.mtu, 1280);
    assert.strictEqual(result._preset, 'stealth');
  });

  it('works with empty base config', () => {
    const result = applyPreset('home-office');
    assert.ok(typeof result === 'object');
    assert.strictEqual(result._preset, 'home-office');
  });

  it('throws for unknown preset name', () => {
    assert.throws(() => applyPreset('nonexistent'), {
      message: 'Unknown preset: nonexistent',
    });
  });
});

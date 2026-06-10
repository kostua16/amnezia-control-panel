import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CHAIN_PRESETS } from '../chain-presets';

describe('BUILTIN_CHAIN_PRESETS', () => {
  it('has at least one preset', () => {
    assert.ok(BUILTIN_CHAIN_PRESETS.length > 0);
  });

  it('has unique ids across all presets', () => {
    const ids = BUILTIN_CHAIN_PRESETS.map((p) => p.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  it('has unique names across all presets', () => {
    const names = BUILTIN_CHAIN_PRESETS.map((p) => p.name);
    assert.strictEqual(new Set(names).size, names.length);
  });

  it('uses valid topologies', () => {
    const validTopologies = ['linear', 'split', 'mesh'];
    for (const preset of BUILTIN_CHAIN_PRESETS) {
      assert.ok(
        validTopologies.includes(preset.topology),
        `Preset "${preset.name}" has invalid topology: ${preset.topology}`,
      );
    }
  });

  it('has nodeCount of at least 2 for each preset', () => {
    for (const preset of BUILTIN_CHAIN_PRESETS) {
      assert.ok(
        preset.nodeCount >= 2,
        `Preset "${preset.name}" has nodeCount < 2: ${preset.nodeCount}`,
      );
    }
  });

  it('all presets have non-empty chainTemplateId', () => {
    for (const preset of BUILTIN_CHAIN_PRESETS) {
      assert.ok(
        preset.chainTemplateId.length > 0,
        `Preset "${preset.name}" has empty chainTemplateId`,
      );
    }
  });

  it('simple-relay preset exists with expected properties', () => {
    const relay = BUILTIN_CHAIN_PRESETS.find((p) => p.id === 'simple-relay');
    assert.ok(relay, 'simple-relay preset not found');
    assert.strictEqual(relay.topology, 'linear');
    assert.strictEqual(relay.nodeCount, 2);
  });
});

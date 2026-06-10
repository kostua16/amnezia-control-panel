/**
 * Unit tests for protocol-templates.ts pure functions.
 *
 * Run: node --import tsx src/lib/__tests__/protocol-templates.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getProtocolTemplates,
  getProtocolTemplate,
} from '../protocol-templates';

describe('getProtocolTemplates', () => {
  it('returns a non-empty array', () => {
    const templates = getProtocolTemplates();
    assert.ok(Array.isArray(templates));
    assert.ok(templates.length > 0);
  });

  it('each template has required fields', () => {
    for (const t of getProtocolTemplates()) {
      assert.ok(typeof t.name === 'string' && t.name.length > 0);
      assert.ok(typeof t.protocol === 'string' && t.protocol.length > 0);
      assert.ok(typeof t.serviceType === 'string');
      assert.ok(typeof t.defaultConfig === 'object');
      assert.ok(typeof t.description === 'string');
    }
  });

  it('includes both AWG and THREE_XUI service types', () => {
    const templates = getProtocolTemplates();
    const hasAWG = templates.some((t) => t.serviceType === 'AWG');
    const hasXUI = templates.some((t) => t.serviceType === 'THREE_XUI');
    assert.ok(hasAWG, 'expected at least one AWG template');
    assert.ok(hasXUI, 'expected at least one THREE_XUI template');
  });
});

describe('getProtocolTemplate', () => {
  it('finds a WireGuard + AWG template', () => {
    const t = getProtocolTemplate('wireguard', 'AWG');
    assert.ok(t);
    assert.strictEqual(t!.protocol, 'wireguard');
    assert.strictEqual(t!.serviceType, 'AWG');
  });

  it('finds a VLESS + THREE_XUI template', () => {
    const t = getProtocolTemplate('vless', 'THREE_XUI');
    assert.ok(t);
    assert.strictEqual(t!.protocol, 'vless');
    assert.strictEqual(t!.serviceType, 'THREE_XUI');
  });

  it('returns undefined for mismatched service type', () => {
    const t = getProtocolTemplate('wireguard', 'THREE_XUI');
    assert.strictEqual(t, undefined);
  });

  it('returns undefined for unknown protocol', () => {
    const t = getProtocolTemplate('nonexistent', 'AWG');
    assert.strictEqual(t, undefined);
  });
});

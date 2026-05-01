import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { signPayload, verifySignature } from '../hmac';
import { generatePerPanelConfig, pushConfigToPanel } from '../panel-sync-client';
import type { ChainConfig } from '@/types/chain';
import type { PanelSyncPayload } from '@/types/panel-sync';

// ─── Test Fixtures ──────────────────────────────────────

function makeChainConfig(): ChainConfig {
  return {
    templateId: 'linear-3',
    nodes: [
      { label: 'Entry Server', serverId: 1, role: 'entry', protocol: 'wireguard', hostname: 'entry.amnezia.ts.net', port: 51820 },
      { label: 'Middle Server', serverId: 2, role: 'middle', protocol: 'xray', hostname: 'middle.amnezia.ts.net', port: 8443 },
      { label: 'Exit Server', serverId: 3, role: 'exit', protocol: 'wireguard', hostname: 'exit.amnezia.ts.net', port: 51820 },
    ],
    wireguardPeers: [
      { nodeId: 'Entry Server', publicKey: 'entry-pub-key', allowedIPs: '10.0.0.2/32', endpoint: 'entry.amnezia.ts.net:51820', persistentKeepalive: 25 },
      { nodeId: 'Middle Server', publicKey: 'middle-pub-key', allowedIPs: '10.0.0.3/32', endpoint: 'middle.amnezia.ts.net:51820' },
      { nodeId: 'Exit Server', publicKey: 'exit-pub-key', allowedIPs: '10.0.0.4/32', endpoint: 'exit.amnezia.ts.net:51820' },
    ],
    xrayRoutingRules: [
      { nodeId: 'Entry Server', type: 'geoip', value: 'RU', outboundTag: 'domestic', priority: 1 },
      { nodeId: 'Exit Server', type: 'domain', value: '.ru', outboundTag: 'domestic', priority: 2 },
      { nodeId: 'Middle Server', type: 'ip', value: '192.168.0.0/16', outboundTag: 'direct', priority: 1 },
    ],
    generatedAt: '2026-04-30T00:00:00Z',
  };
}

// ─── HMAC Tests ─────────────────────────────────────────

describe('signPayload', () => {
  it('produces deterministic HMAC-SHA256 hex string from payload+secret', () => {
    const payload = { foo: 'bar' };
    const secret = 'test-secret';
    const sig1 = signPayload(payload, secret);
    const sig2 = signPayload(payload, secret);
    // Deterministic: same input => same output
    assert.equal(sig1, sig2);
    // Must be a hex string (64 chars for SHA-256)
    assert.match(sig1, /^[a-f0-9]{64}$/);
  });
});

describe('verifySignature', () => {
  it('returns true for matching payload+secret+signature', () => {
    const payload = { configVersion: 1, panelRole: 'entry' };
    const secret = 'my-api-key';
    const signature = signPayload(payload, secret);
    assert.equal(verifySignature(payload, secret, signature), true);
  });

  it('returns false for wrong signature', () => {
    const payload = { configVersion: 1 };
    const secret = 'my-api-key';
    assert.equal(verifySignature(payload, secret, '0000000000000000000000000000000000000000000000000000000000000000'), false);
  });

  it('returns false for wrong secret', () => {
    const payload = { configVersion: 1 };
    const secret1 = 'correct-secret';
    const secret2 = 'wrong-secret';
    const signature = signPayload(payload, secret1);
    assert.equal(verifySignature(payload, secret2, signature), false);
  });
});

// ─── generatePerPanelConfig Tests ───────────────────────

describe('generatePerPanelConfig', () => {
  const chainConfig = makeChainConfig();

  it('returns correct panelRole for entry node', () => {
    const result = generatePerPanelConfig(chainConfig, 1);
    assert.ok(result, 'Expected non-null result for serverId=1');
    assert.equal(result!.panelRole, 'entry');
  });

  it('returns correct panelRole for middle node', () => {
    const result = generatePerPanelConfig(chainConfig, 2);
    assert.ok(result, 'Expected non-null result for serverId=2');
    assert.equal(result!.panelRole, 'middle');
  });

  it('returns correct panelRole for exit node', () => {
    const result = generatePerPanelConfig(chainConfig, 3);
    assert.ok(result, 'Expected non-null result for serverId=3');
    assert.equal(result!.panelRole, 'exit');
  });

  it('includes all chainNodes in the payload (full topology)', () => {
    const result = generatePerPanelConfig(chainConfig, 1);
    assert.ok(result);
    assert.equal(result!.chainNodes.length, 3);
  });

  it('includes only routingRules whose nodeId matches a chainNode label', () => {
    const result = generatePerPanelConfig(chainConfig, 1);
    assert.ok(result);
    // All 3 rules have nodeId matching chain node labels
    assert.equal(result!.routingRules.length, 3);
  });

  it('includes only wireguardPeers whose nodeId matches the matched node', () => {
    const result = generatePerPanelConfig(chainConfig, 1);
    assert.ok(result);
    // Only "Entry Server" peer
    assert.equal(result!.wireguardPeers.length, 1);
    assert.equal(result!.wireguardPeers[0].publicKey, 'entry-pub-key');
  });

  it('returns null for panel with no matching serverId', () => {
    const result = generatePerPanelConfig(chainConfig, 99);
    assert.equal(result, null);
  });
});

// ─── pushConfigToPanel Tests ────────────────────────────

describe('pushConfigToPanel', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Restore original fetch before each test
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const mockPanel = {
    id: 1,
    name: 'Test Panel',
    panelUrl: 'https://panel1.amnezia.ts.net',
    apiKey: 'test-api-key-123',
  };

  const mockPayload: PanelSyncPayload = {
    configVersion: 1,
    panelRole: 'entry',
    chainNodes: [],
    routingRules: [],
    wireguardPeers: [],
    generatedAt: '2026-04-30T00:00:00Z',
  };

  it('calls fetch with X-API-Key header and X-Signature header', async () => {
    let capturedRequest: RequestInit | undefined;
    globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedRequest = init;
      return new Response(JSON.stringify({ success: true, data: { applied: true, configVersion: 1 } }), { status: 200 });
    });

    await pushConfigToPanel(mockPanel, mockPayload);

    assert.ok(capturedRequest);
    assert.ok(capturedRequest!.headers);
    const headers = capturedRequest!.headers as Record<string, string>;
    assert.equal(headers['X-API-Key'], 'test-api-key-123');
    assert.ok(headers['X-Signature']);
    assert.equal(headers['Content-Type'], 'application/json');
  });

  it('returns { success: true, configVersion } on 200 response', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(JSON.stringify({ success: true, data: { applied: true, configVersion: 5 } }), { status: 200 });
    });

    const result = await pushConfigToPanel(mockPanel, mockPayload);
    assert.equal(result.success, true);
    assert.equal(result.configVersion, 5);
    assert.equal(result.panelId, 1);
    assert.equal(result.panelName, 'Test Panel');
    assert.equal(result.error, null);
  });

  it('retries on failure up to 3 times with delays 1s, 2s, 4s', async () => {
    let callCount = 0;
    const callTimestamps: number[] = [];
    globalThis.fetch = mock.fn(async () => {
      callTimestamps.push(Date.now());
      callCount++;
      throw new Error('Network error');
    });

    const result = await pushConfigToPanel(mockPanel, mockPayload);

    // 1 initial attempt + 3 retries = 4 total calls
    assert.equal(callCount, 4);
    assert.equal(result.success, false);
    assert.equal(result.retries, 3);
    assert.ok(result.error);
    // Verify exponential backoff delays between calls
    assert.ok(callTimestamps[1] - callTimestamps[0] >= 900, 'First retry delay should be ~1s');
    assert.ok(callTimestamps[2] - callTimestamps[1] >= 1900, 'Second retry delay should be ~2s');
    assert.ok(callTimestamps[3] - callTimestamps[2] >= 3900, 'Third retry delay should be ~4s');
  });

  it('returns { success: false, error } after 3 failed retries', async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await pushConfigToPanel(mockPanel, mockPayload);
    assert.equal(result.success, false);
    assert.equal(result.retries, 3);
    assert.ok(result.error);
    assert.ok(result.error.length > 0);
  });

  it('succeeds on retry after initial failure', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Temporary error');
      }
      return new Response(JSON.stringify({ success: true, data: { applied: true, configVersion: 2 } }), { status: 200 });
    });

    const result = await pushConfigToPanel(mockPanel, mockPayload);
    assert.equal(result.success, true);
    assert.equal(result.configVersion, 2);
    assert.equal(result.retries, 1);
  });
});

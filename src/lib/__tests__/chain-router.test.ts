import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyChainConfig } from '../chain-router';
import type { ChainConfig } from '@/types/chain';

function makeChainConfig(): ChainConfig {
  return {
    templateId: 'linear-2',
    nodes: [
      { label: 'Entry Server', serverId: 1, role: 'entry', protocol: 'wireguard', hostname: 'entry.ts.net', port: 51820 },
      { label: 'Exit Server', serverId: 2, role: 'exit', protocol: 'xray', hostname: 'exit.ts.net', port: 8443 },
    ],
    wireguardPeers: [
      { nodeId: 'Entry Server', publicKey: 'pub1=', allowedIPs: '10.0.0.2/32', endpoint: 'exit.ts.net:51820', persistentKeepalive: 25 },
      { nodeId: 'Exit Server', publicKey: 'pub2=', allowedIPs: '10.0.0.1/32', endpoint: 'entry.ts.net:51820' },
    ],
    xrayRoutingRules: [
      { nodeId: 'Entry Server', type: 'ip', value: '0.0.0.0/0', outboundTag: 'chain_Exit_Server', priority: 0 },
      { nodeId: 'Exit Server', type: 'ip', value: '0.0.0.0/0', outboundTag: 'direct', priority: 0 },
    ],
    generatedAt: '2026-05-02T00:00:00Z',
  };
}

describe('applyChainConfig', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => { globalThis.fetch = originalFetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('uses panelUrl from credentials map instead of http://hostname:port', async () => {
    const capturedUrls: string[] = [];
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      capturedUrls.push(url.toString());
      return new Response(JSON.stringify({
        success: true, data: { applied: true, configVersion: 1, service: 'awg', message: 'OK' },
      }), { status: 200 });
    });

    const credentials = new Map<number, { panelUrl: string; apiKey: string }>();
    credentials.set(1, { panelUrl: 'https://panel1.amnezia.ts.net:3333', apiKey: 'key-1' });
    credentials.set(2, { panelUrl: 'https://panel2.amnezia.ts.net:3333', apiKey: 'key-2' });

    const result = await applyChainConfig(makeChainConfig(), undefined, credentials);

    assert.ok(capturedUrls.some((u) => u.includes('panel1.amnezia.ts.net:3333')), 'Should use panelUrl for server 1');
    assert.ok(capturedUrls.some((u) => u.includes('panel2.amnezia.ts.net:3333')), 'Should use panelUrl for server 2');
    assert.ok(!capturedUrls.some((u) => u.includes('entry.ts.net:51820/api')), 'Should NOT use raw hostname:port');
    assert.equal(result.success, true);
  });

  it('passes apiKey to applyPanelConfig (verified via X-API-Key header)', async () => {
    let capturedApiKey: string | undefined;
    globalThis.fetch = mock.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedApiKey = (init!.headers as Record<string, string>)['X-API-Key'];
      return new Response(JSON.stringify({
        success: true, data: { applied: true, configVersion: 1, service: 'awg', message: 'OK' },
      }), { status: 200 });
    });

    const credentials = new Map<number, { panelUrl: string; apiKey: string }>();
    credentials.set(1, { panelUrl: 'https://panel1.ts.net', apiKey: 'secret-panel-key' });
    credentials.set(2, { panelUrl: 'https://panel2.ts.net', apiKey: 'another-key' });

    await applyChainConfig(makeChainConfig(), undefined, credentials);

    assert.ok(capturedApiKey, 'X-API-Key header should be present');
    assert.ok(['secret-panel-key', 'another-key'].includes(capturedApiKey), 'Should use apiKey from credentials');
  });

  it('skips nodes with no matching panel credential and reports error', async () => {
    let fetchCallCount = 0;
    globalThis.fetch = mock.fn(async () => {
      fetchCallCount++;
      return new Response(JSON.stringify({
        success: true, data: { applied: true, configVersion: 1, service: 'awg', message: 'OK' },
      }), { status: 200 });
    });

    // Only provide credentials for server 1, not server 2
    const credentials = new Map<number, { panelUrl: string; apiKey: string }>();
    credentials.set(1, { panelUrl: 'https://panel1.ts.net', apiKey: 'key-1' });

    const result = await applyChainConfig(makeChainConfig(), undefined, credentials);

    assert.ok(fetchCallCount >= 1, 'At least one fetch for server 1');
    assert.equal(result.success, false, 'Should report failure due to missing credentials');
    assert.ok(result.errors.some((e) => e.includes('No panel credentials')), 'Should have error about missing credentials');
    assert.ok(result.errors.some((e) => e.includes('server 2')), 'Error should reference server 2');
  });

  it('reports success when all nodes have credentials and apply succeeds', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(JSON.stringify({
        success: true, data: { applied: true, configVersion: 1, service: 'awg', message: 'OK' },
      }), { status: 200 });
    });

    const credentials = new Map<number, { panelUrl: string; apiKey: string }>();
    credentials.set(1, { panelUrl: 'https://panel1.ts.net', apiKey: 'key-1' });
    credentials.set(2, { panelUrl: 'https://panel2.ts.net', apiKey: 'key-2' });

    const result = await applyChainConfig(makeChainConfig(), undefined, credentials);

    assert.equal(result.success, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.appliedTo.length >= 2, 'Both nodes should be in appliedTo');
  });

  it('returns valid result object when sourceIp is provided', async () => {
    let fetchCalled = false;
    globalThis.fetch = mock.fn(async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    });

    const credentials = new Map<number, { panelUrl: string; apiKey: string }>();
    credentials.set(1, { panelUrl: 'https://panel1.ts.net', apiKey: 'key-1' });
    credentials.set(2, { panelUrl: 'https://panel2.ts.net', apiKey: 'key-2' });

    const result = await applyChainConfig(makeChainConfig(), '1.2.3.4', credentials);

    assert.ok(result.appliedTo !== undefined, 'Should return a valid result object');
  });
});

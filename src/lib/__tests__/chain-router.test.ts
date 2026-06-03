import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyChainConfig, generateChainConfig } from '../chain-router';
import { __setDeps, __resetDeps } from '../transport-resolver';
import type { ChainConfig } from '@/types/chain';
import type { Server } from '@/types/server';

// ─── Shared test mocks ──────────────────────────────────

const mockGetNodeIP = mock.fn(async (_hostname?: string) => null);
const mockIsReachable = mock.fn(async (_hostname: string) => true);

function makeChainConfig(): ChainConfig {
  return {
    templateId: 'linear-2',
    nodes: [
      {
        label: 'Entry Server',
        serverId: 1,
        role: 'entry',
        protocol: 'wireguard',
        hostname: 'entry.ts.net',
        port: 51820,
      },
      {
        label: 'Exit Server',
        serverId: 2,
        role: 'exit',
        protocol: 'xray',
        hostname: 'exit.ts.net',
        port: 8443,
      },
    ],
    wireguardPeers: [
      {
        nodeId: 'Entry Server',
        publicKey: 'pub1=',
        allowedIPs: '10.0.0.2/32',
        endpoint: 'exit.ts.net:51820',
        persistentKeepalive: 25,
      },
      {
        nodeId: 'Exit Server',
        publicKey: 'pub2=',
        allowedIPs: '10.0.0.1/32',
        endpoint: 'entry.ts.net:51820',
      },
    ],
    xrayRoutingRules: [
      {
        nodeId: 'Entry Server',
        type: 'ip',
        value: '0.0.0.0/0',
        outboundTag: 'chain_Exit_Server',
        priority: 0,
      },
      {
        nodeId: 'Exit Server',
        type: 'ip',
        value: '0.0.0.0/0',
        outboundTag: 'direct',
        priority: 0,
      },
    ],
    generatedAt: '2026-05-02T00:00:00Z',
  };
}

describe('applyChainConfig', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses panelUrl from credentials map instead of http://hostname:port', async () => {
    const capturedUrls: string[] = [];
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      capturedUrls.push(url.toString());
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            applied: true,
            configVersion: 1,
            service: 'awg',
            message: 'OK',
          },
        }),
        { status: 200 },
      );
    });

    const credentials = new Map<number, { panelUrl: string; apiKey: string }>();
    credentials.set(1, {
      panelUrl: 'https://panel1.amnezia.ts.net:3333',
      apiKey: 'key-1',
    });
    credentials.set(2, {
      panelUrl: 'https://panel2.amnezia.ts.net:3333',
      apiKey: 'key-2',
    });

    const result = await applyChainConfig(
      makeChainConfig(),
      undefined,
      credentials,
    );

    assert.ok(
      capturedUrls.some((u) => u.includes('panel1.amnezia.ts.net:3333')),
      'Should use panelUrl for server 1',
    );
    assert.ok(
      capturedUrls.some((u) => u.includes('panel2.amnezia.ts.net:3333')),
      'Should use panelUrl for server 2',
    );
    assert.ok(
      !capturedUrls.some((u) => u.includes('entry.ts.net:51820/api')),
      'Should NOT use raw hostname:port',
    );
    assert.equal(result.success, true);
  });

  it('passes apiKey to applyPanelConfig (verified via X-API-Key header)', async () => {
    let capturedApiKey: string | undefined;
    globalThis.fetch = mock.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        capturedApiKey = (init!.headers as Record<string, string>)['X-API-Key'];
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              applied: true,
              configVersion: 1,
              service: 'awg',
              message: 'OK',
            },
          }),
          { status: 200 },
        );
      },
    );

    const credentials = new Map<number, { panelUrl: string; apiKey: string }>();
    credentials.set(1, {
      panelUrl: 'https://panel1.ts.net',
      apiKey: 'secret-panel-key',
    });
    credentials.set(2, {
      panelUrl: 'https://panel2.ts.net',
      apiKey: 'another-key',
    });

    await applyChainConfig(makeChainConfig(), undefined, credentials);

    assert.ok(capturedApiKey, 'X-API-Key header should be present');
    assert.ok(
      ['secret-panel-key', 'another-key'].includes(capturedApiKey),
      'Should use apiKey from credentials',
    );
  });

  it('skips nodes with no matching panel credential and reports error', async () => {
    let fetchCallCount = 0;
    globalThis.fetch = mock.fn(async () => {
      fetchCallCount++;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            applied: true,
            configVersion: 1,
            service: 'awg',
            message: 'OK',
          },
        }),
        { status: 200 },
      );
    });

    // Only provide credentials for server 1, not server 2
    const credentials = new Map<number, { panelUrl: string; apiKey: string }>();
    credentials.set(1, { panelUrl: 'https://panel1.ts.net', apiKey: 'key-1' });

    const result = await applyChainConfig(
      makeChainConfig(),
      undefined,
      credentials,
    );

    assert.ok(fetchCallCount >= 1, 'At least one fetch for server 1');
    assert.equal(
      result.success,
      false,
      'Should report failure due to missing credentials',
    );
    assert.ok(
      result.errors.some((e) => e.includes('No panel credentials')),
      'Should have error about missing credentials',
    );
    assert.ok(
      result.errors.some((e) => e.includes('server 2')),
      'Error should reference server 2',
    );
  });

  it('reports success when all nodes have credentials and apply succeeds', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            applied: true,
            configVersion: 1,
            service: 'awg',
            message: 'OK',
          },
        }),
        { status: 200 },
      );
    });

    const credentials = new Map<number, { panelUrl: string; apiKey: string }>();
    credentials.set(1, { panelUrl: 'https://panel1.ts.net', apiKey: 'key-1' });
    credentials.set(2, { panelUrl: 'https://panel2.ts.net', apiKey: 'key-2' });

    const result = await applyChainConfig(
      makeChainConfig(),
      undefined,
      credentials,
    );

    assert.equal(result.success, true);
    assert.equal(result.errors.length, 0);
    assert.ok(
      result.appliedTo.length >= 2,
      'Both nodes should be in appliedTo',
    );
  });

  it('returns valid result object when sourceIp is provided', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response('{}', { status: 200 });
    });

    const credentials = new Map<number, { panelUrl: string; apiKey: string }>();
    credentials.set(1, { panelUrl: 'https://panel1.ts.net', apiKey: 'key-1' });
    credentials.set(2, { panelUrl: 'https://panel2.ts.net', apiKey: 'key-2' });

    const result = await applyChainConfig(
      makeChainConfig(),
      '1.2.3.4',
      credentials,
    );

    assert.ok(
      result.appliedTo !== undefined,
      'Should return a valid result object',
    );
  });
});

// ─── generateChainConfig tests ──────────────────────────

describe('generateChainConfig', () => {
  beforeEach(() => {
    mockGetNodeIP.mock.resetCalls();
    mockIsReachable.mock.resetCalls();
    mockGetNodeIP.mock.mockImplementation(async (_hostname?: string) => null);
    mockIsReachable.mock.mockImplementation(async (_hostname: string) => true);
    __setDeps({ getNodeIP: mockGetNodeIP, isReachable: mockIsReachable });
  });

  afterEach(() => {
    __resetDeps();
  });

  function makeServers(): Server[] {
    return [
      {
        id: 1,
        name: 'Entry',
        hostname: 'entry.example.com',
        port: 22,
        isActive: true,
        tailnetIP: '100.64.0.1',
        tailnetHostname: 'entry',
        createdAt: new Date(),
      },
      {
        id: 2,
        name: 'Exit',
        hostname: 'exit.example.com',
        port: 22,
        isActive: true,
        tailnetIP: '100.64.0.2',
        tailnetHostname: 'exit',
        createdAt: new Date(),
      },
    ];
  }

  // Test 1: Tailscale IPs in WireGuard peer endpoints
  it('produces WireGuard peer endpoints with Tailscale IPs (100.x.y.z), NOT server.hostname', async () => {
    const servers = makeServers();
    const serverMapping: Record<number, number> = { 0: 1, 1: 2 };

    const config = await generateChainConfig(
      '2hop-linear',
      servers,
      serverMapping,
    );

    // At least one endpoint should contain the Tailscale IP
    const allEndpoints = config.wireguardPeers.map((p) => p.endpoint);
    const hasTailscale = allEndpoints.some(
      (ep) => ep.includes('100.64.0.1') || ep.includes('100.64.0.2'),
    );
    assert.ok(
      hasTailscale,
      `Expected Tailscale IP in endpoints, got: ${allEndpoints.join(', ')}`,
    );

    // No endpoint should contain raw hostname
    const hasRawHostname = allEndpoints.some(
      (ep) =>
        ep.includes('entry.example.com') || ep.includes('exit.example.com'),
    );
    assert.ok(
      !hasRawHostname,
      `Endpoints should NOT contain raw hostnames, got: ${allEndpoints.join(', ')}`,
    );
  });

  // Test 2: WireGuard port uses service port (51820), NOT server.port (22)
  it('uses WireGuard service port (default 51820) in peer endpoints, NOT server.port', async () => {
    const servers = makeServers();
    // server.port is 22 (SSH), but WireGuard should use 51820
    const serverMapping: Record<number, number> = { 0: 1, 1: 2 };

    const config = await generateChainConfig(
      '2hop-linear',
      servers,
      serverMapping,
    );

    // No endpoint should contain port 22 (SSH port)
    const allEndpoints = config.wireguardPeers.map((p) => p.endpoint);
    const hasSSH22 = allEndpoints.some((ep) => ep.endsWith(':22'));
    assert.ok(
      !hasSSH22,
      `Endpoints should NOT use SSH port 22, got: ${allEndpoints.join(', ')}`,
    );

    // Endpoints should use port 51820 (default WireGuard port)
    const hasWGPort = allEndpoints.some((ep) => ep.includes(':51820'));
    assert.ok(
      hasWGPort,
      `Expected WireGuard port 51820 in endpoints, got: ${allEndpoints.join(', ')}`,
    );
  });

  // Test 3: generateChainConfig is async
  it('returns a Promise (is async)', async () => {
    const servers = makeServers();
    const serverMapping: Record<number, number> = { 0: 1, 1: 2 };

    const result = generateChainConfig('2hop-linear', servers, serverMapping);
    assert.ok(
      result instanceof Promise,
      'generateChainConfig should return a Promise',
    );
    const config = await result;
    assert.ok(config.templateId, 'Resolved config should have templateId');
  });

  // Test 4: Fallback to server.hostname when transport resolution fails
  it('falls back to server.hostname when transport resolution fails (with warning)', async () => {
    // No tailnetIP -- resolution will fail all tiers
    const servers: Server[] = [
      {
        id: 1,
        name: 'Entry',
        hostname: 'raw.example.com',
        port: 22,
        isActive: true,
        createdAt: new Date(),
      },
      {
        id: 2,
        name: 'Exit',
        hostname: 'raw2.example.com',
        port: 22,
        isActive: true,
        createdAt: new Date(),
      },
    ];
    const serverMapping: Record<number, number> = { 0: 1, 1: 2 };

    // Capture console.warn
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '));
    };

    try {
      const config = await generateChainConfig(
        '2hop-linear',
        servers,
        serverMapping,
      );

      // Should still produce a config (fallback behavior)
      assert.ok(config.templateId, 'Should still produce a config');
      assert.ok(config.nodes.length === 2, 'Should have 2 nodes');

      // Endpoints should contain raw hostname (fallback)
      const allEndpoints = config.wireguardPeers.map((p) => p.endpoint);
      const hasRawHostname = allEndpoints.some(
        (ep) =>
          ep.includes('raw.example.com') || ep.includes('raw2.example.com'),
      );
      assert.ok(
        hasRawHostname,
        `Fallback should use raw hostname, got: ${allEndpoints.join(', ')}`,
      );

      // Warning should have been logged
      assert.ok(
        warnings.length > 0,
        'Should log a warning when transport resolution fails',
      );
    } finally {
      console.warn = origWarn;
    }
  });
});

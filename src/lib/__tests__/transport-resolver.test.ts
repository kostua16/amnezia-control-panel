import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Unit tests for resolvePanelTransport (3-tier Tailscale fallback).
 *
 * Uses __setDeps() to inject mock tailscale functions, avoiding tsx
 * non-configurable getter issues with mock.method().
 *
 * Run: node --import tsx src/lib/__tests__/transport-resolver.test.ts
 */

let mockGetNodeIP: ReturnType<typeof mock.fn>;
let mockIsReachable: ReturnType<typeof mock.fn>;
let setDeps: (deps: any) => void;
let resetDeps: () => void;

beforeEach(async () => {
  mockGetNodeIP = mock.fn(async (_hostname?: string) => null);
  mockIsReachable = mock.fn(async (_hostname: string) => true);

  const resolver = await import('../transport-resolver');
  setDeps = resolver.__setDeps;
  resetDeps = resolver.__resetDeps;
  setDeps({ getNodeIP: mockGetNodeIP, isReachable: mockIsReachable });
});

afterEach(() => {
  resetDeps();
});

describe('resolvePanelTransport', () => {
  it('Tier 1 (DB cache): returns tailscaleIP from server.tailnetIP without calling getNodeIP', async () => {
    const { resolvePanelTransport } = await import('../transport-resolver');

    const result = await resolvePanelTransport(
      { id: 1, tailnetIP: '100.64.0.1', tailnetHostname: 'server1.ts.net', hostname: 'raw-host' },
      { panelUrl: 'https://example.com' },
    );

    assert.ok(result, 'Should return a ResolvedTransport');
    assert.equal(result!.source, 'db');
    assert.equal(result!.tailscaleIP, '100.64.0.1');
    assert.equal(result!.hostname, 'server1.ts.net');
    assert.equal(result!.port, 443);
    assert.equal(result!.online, true);

    assert.ok(result!.panelUrl.includes('100.64.0.1'), `panelUrl should contain IP, got: ${result!.panelUrl}`);
    assert.ok(result!.panelUrl.startsWith('https://'), `panelUrl should use https, got: ${result!.panelUrl}`);

    const parsed = new URL(result!.panelUrl);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, '100.64.0.1');

    assert.equal(mockGetNodeIP.mock.callCount(), 0, 'getNodeIP should not be called for Tier 1 hit');
    assert.ok(mockIsReachable.mock.callCount() >= 1, 'isReachable should be called');
  });

  it('Tier 2 (CLI tailnetHostname): resolves via getNodeIP returning correct tailscaleIP', async () => {
    mockGetNodeIP.mock.mockImplementation(async (hostname?: string) => {
      if (hostname === 'server1.ts.net') return '100.64.0.2';
      return null;
    });

    const { resolvePanelTransport } = await import('../transport-resolver');

    const result = await resolvePanelTransport(
      { id: 2, tailnetIP: null, tailnetHostname: 'server1.ts.net', hostname: 'raw-host' },
      { panelUrl: 'https://example.com' },
    );

    assert.ok(result, 'Should return a ResolvedTransport');
    assert.equal(result!.source, 'cli-resolve');
    assert.equal(result!.tailscaleIP, '100.64.0.2');
    assert.equal(result!.hostname, 'server1.ts.net');

    assert.ok(mockGetNodeIP.mock.callCount() >= 1, 'getNodeIP should be called for CLI resolution');
  });

  it('Tier 3 (CLI hostname fallback): resolves via server hostname when tailnetHostname is absent', async () => {
    mockGetNodeIP.mock.mockImplementation(async (hostname?: string) => {
      if (hostname === 'raw-host') return '100.64.0.3';
      return null;
    });

    const { resolvePanelTransport } = await import('../transport-resolver');

    const result = await resolvePanelTransport(
      { id: 3, tailnetIP: null, tailnetHostname: null, hostname: 'raw-host' },
      { panelUrl: 'https://example.com' },
    );

    assert.ok(result, 'Should return a ResolvedTransport');
    assert.equal(result!.source, 'fallback');
    assert.equal(result!.tailscaleIP, '100.64.0.3');
    assert.equal(result!.hostname, 'raw-host');

    assert.ok(mockGetNodeIP.mock.callCount() >= 1, 'getNodeIP should be called for hostname fallback');
  });

  it('All tiers fail: returns null (not throw)', async () => {
    const { resolvePanelTransport } = await import('../transport-resolver');

    const result = await resolvePanelTransport(
      { id: 4, tailnetIP: null, tailnetHostname: 'server4.ts.net', hostname: 'server4' },
      { panelUrl: 'https://example.com' },
    );

    assert.equal(result, null, 'Should return null when all tiers fail');
  });

  it('Custom port: panelUrl contains the specified port', async () => {
    const { resolvePanelTransport } = await import('../transport-resolver');

    const result = await resolvePanelTransport(
      { id: 5, tailnetIP: '100.64.0.5', tailnetHostname: 'server5.ts.net', hostname: 'raw-host' },
      { panelUrl: 'https://example.com' },
      3333,
    );

    assert.ok(result, 'Should return a ResolvedTransport');
    assert.equal(result!.port, 3333);
    assert.ok(result!.panelUrl.includes(':3333'), `panelUrl should contain :3333, got: ${result!.panelUrl}`);

    const parsed = new URL(result!.panelUrl);
    assert.equal(parsed.port, '3333');
  });

  it('panelUrl is a valid URL constructable by new URL()', async () => {
    const { resolvePanelTransport } = await import('../transport-resolver');

    const result = await resolvePanelTransport(
      { id: 6, tailnetIP: '100.64.0.6', tailnetHostname: 'server6.ts.net', hostname: 'raw-host' },
      { panelUrl: 'https://example.com' },
    );

    assert.ok(result, 'Should return a ResolvedTransport');

    const parsed = new URL(result!.panelUrl);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, '100.64.0.6');
    assert.ok(parsed.port === '' || parsed.port === '443', 'Port should be empty (default 443) or 443');
  });
});

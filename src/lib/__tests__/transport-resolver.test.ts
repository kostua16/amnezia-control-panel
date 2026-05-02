import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Unit tests for resolvePanelTransport (3-tier Tailscale fallback).
 *
 * Mock strategy:
 *   - Mock @/lib/tailscale via preload script (_setup-transport-mock.cjs)
 *     which redirects tailscale imports to _tailscale-mock.cjs
 *   - The prisma dynamic import in transport-resolver.ts is allowed to fail
 *     silently (caught by the try/catch in the implementation), so cache-back
 *     is not asserted in tests -- it is an internal best-effort side effect.
 *
 * Run: node --import tsx --require ./src/lib/__tests__/_setup-transport-mock.cjs src/lib/__tests__/transport-resolver.test.ts
 */

interface TailscaleMockFn {
  (...args: unknown[]): Promise<unknown>;
  __mockMeta?: { calls: Array<Array<unknown>>; reset: () => void; mockImplementation: (fn: (...args: unknown[]) => unknown) => void };
}

let tailscaleGetNodeIP: TailscaleMockFn;
let tailscaleIsReachable: TailscaleMockFn;

beforeEach(async () => {
  const tsRaw = await import('../__tests__/_tailscale-mock.cjs');
  const tsModule = (tsRaw.default ?? tsRaw) as { getNodeIP: TailscaleMockFn; isReachable: TailscaleMockFn };
  tailscaleGetNodeIP = tsModule.getNodeIP;
  tailscaleIsReachable = tsModule.isReachable;

  // Reset to defaults before each test
  tailscaleGetNodeIP.__mockMeta?.reset();
  tailscaleGetNodeIP.__mockMeta?.mockImplementation(async () => null);
  tailscaleIsReachable.__mockMeta?.reset();
  tailscaleIsReachable.__mockMeta?.mockImplementation(async () => true);
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

    // panelUrl uses new URL() -- port 443 is default for https and is omitted per URL spec
    assert.ok(result!.panelUrl.includes('100.64.0.1'), `panelUrl should contain IP, got: ${result!.panelUrl}`);
    assert.ok(result!.panelUrl.startsWith('https://'), `panelUrl should use https, got: ${result!.panelUrl}`);

    // Verify URL is well-formed (parseable)
    const parsed = new URL(result!.panelUrl);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, '100.64.0.1');

    // getNodeIP should NOT have been called (Tier 1 hit DB cache)
    assert.equal(tailscaleGetNodeIP.__mockMeta?.calls.length, 0, 'getNodeIP should not be called for Tier 1 hit');

    // isReachable SHOULD have been called
    assert.ok((tailscaleIsReachable.__mockMeta?.calls.length ?? 0) >= 1, 'isReachable should be called');
  });

  it('Tier 2 (CLI tailnetHostname): resolves via getNodeIP returning correct tailscaleIP', async () => {
    // Configure getNodeIP to return IP for tailnetHostname
    tailscaleGetNodeIP.__mockMeta!.mockImplementation(async (hostname?: string) => {
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

    // Verify getNodeIP was called with the tailnetHostname
    const calls = tailscaleGetNodeIP.__mockMeta?.calls ?? [];
    assert.ok(calls.length >= 1, 'getNodeIP should be called');
    assert.equal(calls[0][0], 'server1.ts.net', 'First call should use tailnetHostname');
  });

  it('Tier 3 (CLI hostname fallback): resolves via server hostname when tailnetHostname is absent', async () => {
    // Configure getNodeIP to return IP only for the raw hostname
    tailscaleGetNodeIP.__mockMeta!.mockImplementation(async (hostname?: string) => {
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

    // Verify getNodeIP was called with the raw hostname
    const calls = tailscaleGetNodeIP.__mockMeta?.calls ?? [];
    assert.ok(calls.length >= 1, 'getNodeIP should be called');
    assert.equal(calls[0][0], 'raw-host', 'Call should use server hostname');
  });

  it('All tiers fail: returns null (not throw)', async () => {
    // Default mock: getNodeIP returns null for all calls
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

    // Verify the URL is well-formed with the custom port
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

    // Verify the panelUrl is parseable by URL constructor (no string concat artifacts)
    const parsed = new URL(result!.panelUrl);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, '100.64.0.6');
    // Port 443 is the default for https -- it is omitted in URL serialization
    assert.ok(parsed.port === '' || parsed.port === '443', 'Port should be empty (default 443) or 443');
  });
});

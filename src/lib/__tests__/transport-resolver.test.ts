/**
 * Unit tests for transport-resolver.ts
 *
 * Run: node --import tsx src/lib/__tests__/transport-resolver.test.ts
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePanelTransport } from '../transport-resolver';

// ─── Test Doubles ───────────────────────────────────────

let mockGetNodeIP: ReturnType<typeof mock.fn>;
let mockIsReachable: ReturnType<typeof mock.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let setDeps: (deps: any) => void;
let resetDeps: () => void;

beforeEach(async () => {
  mockGetNodeIP = mock.fn(async (_hostname?: string) => null);

  mockIsReachable = mock.fn(async (_hostname: string) => true);

  // Import the deps setter/resetter after mocking is configured
  const resolver = await import('../transport-resolver');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDeps = (resolver as any).__setDeps;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resetDeps = (resolver as any).__resetDeps;

  setDeps({
    getNodeIP: mockGetNodeIP,
    isReachable: mockIsReachable,
  });
});

// ─── Tests ───────────────────────────────────────────────

describe('transport-resolver', () => {
  it('should resolve wireguard for entry node with wireguard protocol', async () => {
    // Tier 3: getNodeIP returns hostname as resolved IP
    mockGetNodeIP.mock.mockImplementationOnce(async () => 'entry.example.com');

    const result = await resolvePanelTransport(
      { id: 1, hostname: 'entry.example.com', tailnetIP: null } as const,
      { panelUrl: 'https://entry.example.com:51820' },
      51820,
    );

    assert.strictEqual(result?.panelUrl, 'https://entry.example.com:51820');
    assert.strictEqual(result?.tailscaleIP, 'entry.example.com');
    assert.strictEqual(result?.port, 51820);
    assert.strictEqual(result?.hostname, 'entry.example.com');
  });

  it('should use cached IP address when available', async () => {
    mockGetNodeIP.mock.mockImplementationOnce(async () => '10.0.0.5');

    const result = await resolvePanelTransport(
      { id: 1, hostname: 'cached.example.com', tailnetIP: null } as const,
      { panelUrl: 'https://cached.example.com:51820' },
      51820,
    );

    assert.strictEqual(result?.tailscaleIP, '10.0.0.5');
    assert.strictEqual(result?.port, 51820);
  });
});

describe('transport-resolver Tier 1 (DB cache)', () => {
  it('returns DB-cached tailnetIP without calling getNodeIP', async () => {
    const result = await resolvePanelTransport(
      {
        id: 10,
        tailnetIP: '100.64.0.1',
        tailnetHostname: 'my-server',
        hostname: 'my-server.example.com',
      },
      { panelUrl: 'https://my-server.example.com:443' },
      443,
    );

    assert.ok(result, 'should resolve when tailnetIP is cached');
    assert.strictEqual(result.tailscaleIP, '100.64.0.1');
    assert.strictEqual(result.source, 'db');
    assert.strictEqual(result.panelUrl, 'https://100.64.0.1:443');
    assert.strictEqual(result.hostname, 'my-server');
    assert.strictEqual(
      mockGetNodeIP.mock.callCount(),
      0,
      'getNodeIP should not be called when DB cache hits',
    );
  });

  it('prefers DB cache over CLI resolution', async () => {
    mockGetNodeIP.mock.mockImplementationOnce(async () => '10.99.99.99');

    const result = await resolvePanelTransport(
      {
        id: 11,
        tailnetIP: '100.64.0.2',
        hostname: 'cached.example.com',
      },
      { panelUrl: 'https://cached.example.com' },
      443,
    );

    assert.strictEqual(result?.tailscaleIP, '100.64.0.2');
    assert.strictEqual(result?.source, 'db');
    assert.strictEqual(mockGetNodeIP.mock.callCount(), 0);
  });
});

describe('transport-resolver failure paths', () => {
  it('returns null when all tiers fail', async () => {
    const result = await resolvePanelTransport(
      { id: 99, hostname: 'unreachable.example.com', tailnetIP: null },
      { panelUrl: 'https://unreachable.example.com' },
    );

    assert.strictEqual(result, null);
  });

  it('uses default port 443 when not specified', async () => {
    mockGetNodeIP.mock.mockImplementationOnce(async () => '10.0.0.5');

    const result = await resolvePanelTransport(
      { id: 5, hostname: 'default-port.example.com', tailnetIP: null },
      { panelUrl: 'https://default-port.example.com' },
    );

    assert.strictEqual(result?.port, 443);
    assert.strictEqual(result?.panelUrl, 'https://10.0.0.5:443');
  });
});

afterEach(() => {
  resetDeps();
});

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
    const result = await resolvePanelTransport(
      { id: 1, hostname: 'entry.example.com', tailnetIP: null } as const,
      { panelUrl: 'https://entry.example.com:51820' },
      51820
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
      51820
    );

    assert.strictEqual(result?.tailscaleIP, '10.0.0.5');
    assert.strictEqual(result?.port, 51820);
  });

  afterEach(() => {
    resetDeps();
  });
});

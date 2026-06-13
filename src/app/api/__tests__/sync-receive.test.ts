import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signPayload } from '@/lib/hmac';
import { POST } from '../sync/receive/route';
import { postRequest, readJson } from '@/lib/__tests__/helpers/test-server';

const PATH = '/api/sync/receive';
const API_KEY = 'test-panel-api-key';

type SyncErrorBody = {
  success?: boolean;
  error: string;
};

type SyncSuccessBody = {
  success: boolean;
  data: {
    applied: boolean;
    configVersion: number;
  };
};

// Save originals; restore after each test so stubs never leak.
const orig = {
  findMany: prisma.remotePanel.findMany,
  findUnique: prisma.cachedPanelConfig.findUnique,
  create: prisma.cachedPanelConfig.create,
  execRawUnsafe: prisma.$executeRawUnsafe,
  execRaw: prisma.$executeRaw,
};

function validPayload() {
  return {
    configVersion: 1,
    panelRole: 'entry' as const,
    chainNodes: [
      {
        label: 'Entry',
        serverId: 1,
        role: 'entry' as const,
        protocol: 'wireguard' as const,
        hostname: '10.0.0.1',
        port: 51820,
      },
    ],
    routingRules: [
      {
        type: 'ip' as const,
        value: '0.0.0.0/0',
        outboundTag: 'direct',
        priority: 1,
      },
    ],
    wireguardPeers: [
      { publicKey: 'pub', allowedIPs: '0.0.0.0/0', endpoint: '10.0.0.1:51820' },
    ],
    generatedAt: '2024-01-01T00:00:00Z',
  };
}

/** A panel whose stored API-key hash matches {@link API_KEY}. */
function hashedPanel() {
  return {
    id: 1,
    apiKeyHash: bcrypt.hashSync(API_KEY, 4),
    isActive: true,
  };
}

function restore() {
  prisma.remotePanel.findMany = orig.findMany;
  prisma.cachedPanelConfig.findUnique = orig.findUnique;
  prisma.cachedPanelConfig.create = orig.create;
  prisma.$executeRawUnsafe = orig.execRawUnsafe;
  prisma.$executeRaw = orig.execRaw;
}

beforeEach(() => {
  prisma.remotePanel.findMany = orig.findMany;
  prisma.cachedPanelConfig.findUnique = orig.findUnique;
  prisma.cachedPanelConfig.create = orig.create;
  // writeAuditLog must not touch a real DB.
  prisma.$executeRawUnsafe = (async () => 1) as never;
  prisma.$executeRaw = (async () => 1) as never;
});
afterEach(restore);

describe('POST /api/sync/receive', () => {
  it('rejects a request missing auth headers with 401', async () => {
    const { status, body } = await readJson<SyncErrorBody>(
      await POST(postRequest(PATH, validPayload())),
    );
    assert.strictEqual(status, 401);
    assert.strictEqual(body.success, false);
  });

  it('rejects an API key that matches no active panel with 401', async () => {
    prisma.remotePanel.findMany = (async () => []) as never;
    const { status, body } = await readJson<SyncErrorBody>(
      await POST(
        postRequest(PATH, validPayload(), {
          'X-API-Key': 'wrong-key',
          'X-Signature': 'sig',
        }),
      ),
    );
    assert.strictEqual(status, 401);
    assert.strictEqual(body.error, 'Invalid API key');
  });

  it('rejects a payload with a valid key but bad signature with 401', async () => {
    prisma.remotePanel.findMany = (async () => [hashedPanel()]) as never;
    const { status, body } = await readJson<SyncErrorBody>(
      await POST(
        postRequest(PATH, validPayload(), {
          'X-API-Key': API_KEY,
          'X-Signature': 'not-the-real-signature',
        }),
      ),
    );
    assert.strictEqual(status, 401);
    assert.strictEqual(body.error, 'Invalid signature');
  });

  it('rejects a structurally invalid payload with 400 after key match', async () => {
    prisma.remotePanel.findMany = (async () => [hashedPanel()]) as never;
    const bad = { ...validPayload(), configVersion: 'not-a-number' };
    const { status, body } = await readJson<SyncErrorBody>(
      await POST(
        postRequest(PATH, bad, {
          'X-API-Key': API_KEY,
          'X-Signature': 'sig',
        }),
      ),
    );
    assert.strictEqual(status, 400);
    assert.ok(body.error.startsWith('Invalid payload'));
  });

  it('stores a valid, correctly-signed payload and returns 200', async () => {
    prisma.remotePanel.findMany = (async () => [hashedPanel()]) as never;
    prisma.cachedPanelConfig.findUnique = (async () => null) as never;
    let createdPanelId: number | null = null;
    prisma.cachedPanelConfig.create = (async (args: {
      data: { panelId: number };
    }) => {
      createdPanelId = args.data.panelId;
      return { id: 99 };
    }) as never;

    const payload = validPayload();
    const signature = signPayload(payload, API_KEY);
    const { status, body } = await readJson<SyncSuccessBody>(
      await POST(
        postRequest(PATH, payload, {
          'X-API-Key': API_KEY,
          'X-Signature': signature,
        }),
      ),
    );
    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.applied, true);
    assert.strictEqual(body.data.configVersion, 1);
    assert.strictEqual(
      createdPanelId,
      1,
      'persisted config against matched panel',
    );
  });
});

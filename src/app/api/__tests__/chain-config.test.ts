import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { POST } from '../panels/push/chain-config/route';
import { postRequest, readJson } from '@/lib/__tests__/helpers/test-server';

const PATH = '/api/panels/push/chain-config';

type ChainConfigErrorBody = {
  success?: boolean;
  error: string;
};

type ChainConfigSuccessBody = {
  success: boolean;
  data: {
    templateId: string;
    routingOptions?: {
      split?: {
        directGeoipTags: string[];
      };
    };
    nodes: Array<{ hostname: string }>;
    wireguardPeers: unknown[];
    xrayRoutingRules: Array<{ type: string; value: string }>;
    generatedAt: string;
  };
};

const orig = {
  remoteFindMany: prisma.remotePanel.findMany,
  serviceFindFirst: prisma.service.findFirst,
  serverFindFirst: prisma.server.findFirst,
  execRawUnsafe: prisma.$executeRawUnsafe,
  execRaw: prisma.$executeRaw,
};

/** Two active panels mapped by node index, with parseable panel URLs. */
function activePanels(ids: number[]) {
  return ids.map((id) => ({
    id,
    name: `panel-${id}`,
    panelUrl: `https://10.0.0.${id}:443`,
    isActive: true,
  }));
}

beforeEach(() => {
  // Force the panelUrl-parsing fallback by reporting no matching Server row.
  prisma.server.findFirst = (async () => null) as never;
  // writeAuditLog must not hit a real DB.
  prisma.$executeRawUnsafe = (async () => 1) as never;
  prisma.$executeRaw = (async () => 1) as never;
});
afterEach(() => {
  prisma.remotePanel.findMany = orig.remoteFindMany;
  prisma.service.findFirst = orig.serviceFindFirst;
  prisma.server.findFirst = orig.serverFindFirst;
  prisma.$executeRawUnsafe = orig.execRawUnsafe;
  prisma.$executeRaw = orig.execRaw;
});

describe('POST /api/panels/push/chain-config — validation', () => {
  it('rejects a body missing templateId with 422', async () => {
    const { status, body } = await readJson<ChainConfigErrorBody>(
      await POST(postRequest(PATH, { panelMapping: { 0: 1 } })),
    );
    assert.strictEqual(status, 422);
    assert.strictEqual(body.success, false);
  });

  it('rejects an unknown templateId with 404', async () => {
    const { status, body } = await readJson<ChainConfigErrorBody>(
      await POST(
        postRequest(PATH, { templateId: 'no-such-template', panelMapping: {} }),
      ),
    );
    assert.strictEqual(status, 404);
    assert.ok(body.error.includes('Template not found'));
  });

  it('rejects duplicate panel assignments within the mapping with 422', async () => {
    prisma.remotePanel.findMany = (async () => activePanels([1])) as never;
    const { status, body } = await readJson<ChainConfigErrorBody>(
      await POST(
        postRequest(PATH, {
          templateId: '2hop-linear',
          panelMapping: { 0: 1, 1: 1 },
        }),
      ),
    );
    assert.strictEqual(status, 422);
    assert.strictEqual(
      body.error,
      'Panel mapping contains duplicate panel assignments',
    );
  });

  it('rejects split routing without direct GeoIP zones with 422', async () => {
    const { status, body } = await readJson<ChainConfigErrorBody>(
      await POST(
        postRequest(PATH, {
          templateId: 'split-routing',
          panelMapping: { 0: 1, 1: 2 },
        }),
      ),
    );

    assert.strictEqual(status, 422);
    assert.strictEqual(
      body.error,
      'Split routing requires at least one direct GeoIP zone tag',
    );
  });
});

describe('POST /api/panels/push/chain-config — generation', () => {
  it('generates a linear chain (2 nodes → 2 WireGuard peers)', async () => {
    prisma.remotePanel.findMany = (async () => activePanels([1, 2])) as never;
    prisma.service.findFirst = (async () => null) as never;

    const { status, body } = await readJson<ChainConfigSuccessBody>(
      await POST(
        postRequest(PATH, {
          templateId: '2hop-linear',
          panelMapping: { 0: 1, 1: 2 },
        }),
      ),
    );
    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.templateId, '2hop-linear');
    assert.strictEqual(body.data.nodes.length, 2);
    // Linear N nodes produce 2*(N-1) peers (bidirectional between consecutive hops).
    assert.strictEqual(body.data.wireguardPeers.length, 2);
    assert.ok(Array.isArray(body.data.xrayRoutingRules));
    assert.ok(body.data.generatedAt, 'includes a generatedAt timestamp');
  });

  it('generates a mesh chain (3 nodes → 6 fully-meshed peers)', async () => {
    prisma.remotePanel.findMany = (async () =>
      activePanels([1, 2, 3])) as never;
    prisma.service.findFirst = (async () => null) as never;

    const { status, body } = await readJson<ChainConfigSuccessBody>(
      await POST(
        postRequest(PATH, {
          templateId: 'mesh-redundant',
          panelMapping: { 0: 1, 1: 2, 2: 3 },
        }),
      ),
    );
    assert.strictEqual(status, 200);
    // Mesh of N nodes produces N*(N-1) directed peers.
    assert.strictEqual(body.data.wireguardPeers.length, 6);
  });

  it('generates split routing with the requested direct GeoIP zone', async () => {
    prisma.remotePanel.findMany = (async () => activePanels([1, 2])) as never;
    prisma.service.findFirst = (async () => null) as never;

    const { status, body } = await readJson<ChainConfigSuccessBody>(
      await POST(
        postRequest(PATH, {
          templateId: 'split-routing',
          panelMapping: { 0: 1, 1: 2 },
          routingOptions: { split: { directGeoipTags: ['KZ'] } },
        }),
      ),
    );

    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body.data.routingOptions, {
      split: { directGeoipTags: ['kz'] },
    });
    assert.ok(
      body.data.xrayRoutingRules.some(
        (r) => r.type === 'geoip' && r.value === 'kz',
      ),
    );
    assert.ok(
      !body.data.xrayRoutingRules.some(
        (r) => r.type === 'geoip' && r.value === 'ru',
      ),
    );
  });

  it('falls back to panelUrl parsing when no Server row matches', async () => {
    prisma.remotePanel.findMany = (async () => activePanels([7, 8])) as never;
    prisma.service.findFirst = (async () => null) as never;

    const { status, body } = await readJson<ChainConfigSuccessBody>(
      await POST(
        postRequest(PATH, {
          templateId: '2hop-linear',
          panelMapping: { 0: 7, 1: 8 },
        }),
      ),
    );
    assert.strictEqual(status, 200);
    // hostnames derive from the panelUrl hosts (10.0.0.7 / 10.0.0.8).
    const hosts = body.data.nodes.map((n) => n.hostname);
    assert.ok(hosts.includes('10.0.0.7'));
    assert.ok(hosts.includes('10.0.0.8'));
  });
});

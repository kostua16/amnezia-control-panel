import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { GET, POST } from '../routing/geo/route';
import { postRequest, readJson } from '@/lib/__tests__/helpers/test-server';

const PATH = '/api/routing/geo';

type GeoRule = {
  id: number;
  action: string;
  matchType: string;
  target: { countryCode: string };
};

type GeoListBody = {
  success: boolean;
  data: GeoRule[];
};

type GeoErrorBody = {
  error: string;
};

type GeoCreateBody = {
  success: boolean;
  data: GeoRule;
};

const orig = {
  count: prisma.geoRoutingRule.count,
  findMany: prisma.geoRoutingRule.findMany,
  create: prisma.geoRoutingRule.create,
  execRawUnsafe: prisma.$executeRawUnsafe,
  execRaw: prisma.$executeRaw,
};

function ruleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Block RU',
    matchType: 'country',
    countryCode: 'RU',
    region: null,
    special: null,
    action: 'BLOCK',
    chainId: null,
    priority: 10,
    isActive: true,
    source: 'custom',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  // writeAuditLog must not touch a real DB.
  prisma.$executeRawUnsafe = (async () => 1) as never;
  prisma.$executeRaw = (async () => 1) as never;
});
afterEach(() => {
  prisma.geoRoutingRule.count = orig.count;
  prisma.geoRoutingRule.findMany = orig.findMany;
  prisma.geoRoutingRule.create = orig.create;
  prisma.$executeRawUnsafe = orig.execRawUnsafe;
  prisma.$executeRaw = orig.execRaw;
});

describe('GET /api/routing/geo', () => {
  it('lists rules ordered by priority with 200', async () => {
    prisma.geoRoutingRule.count = (async () => 2) as never; // migration skips when table non-empty
    prisma.geoRoutingRule.findMany = (async () => [
      ruleRow({ id: 1, priority: 10 }),
      ruleRow({ id: 2, priority: 5, name: 'Allow EU', countryCode: 'EU' }),
    ]) as never;

    const { status, body } = await readJson<GeoListBody>(await GET());
    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.length, 2);
    assert.strictEqual(body.data[0].target.countryCode, 'RU');
    // Stored matchType is surfaced in the API shape.
    assert.strictEqual(body.data[1].matchType, 'country');
  });
});

describe('POST /api/routing/geo — validation', () => {
  it('rejects a rule with no target field with 422', async () => {
    const { status, body } = await readJson<GeoErrorBody>(
      await POST(
        postRequest(PATH, { name: 'Bad', target: {}, action: 'BLOCK' }),
      ),
    );
    assert.strictEqual(status, 422);
    assert.ok(body.error.includes('target field'));
  });

  it('rejects an unknown action with 422', async () => {
    const { status } = await readJson(
      await POST(
        postRequest(PATH, {
          name: 'Bad',
          target: { countryCode: 'RU' },
          action: 'BOGUS',
        }),
      ),
    );
    assert.strictEqual(status, 422);
  });
});

describe('POST /api/routing/geo — create', () => {
  it('creates a country-BLOCK rule and returns 201', async () => {
    let captured: Record<string, unknown> | null = null;
    prisma.geoRoutingRule.create = (async (args: {
      data: Record<string, unknown>;
    }) => {
      captured = args.data;
      return ruleRow({ ...args.data, id: 42 } as never);
    }) as never;

    const { status, body } = await readJson<GeoCreateBody>(
      await POST(
        postRequest(PATH, {
          name: 'Block RU',
          target: { countryCode: 'RU' },
          action: 'BLOCK',
          priority: 10,
        }),
      ),
    );
    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.id, 42);
    assert.strictEqual(body.data.action, 'BLOCK');
    assert.strictEqual(body.data.target.countryCode, 'RU');
    assert.ok(captured, 'persisted the rule via prisma.create');
  });
});

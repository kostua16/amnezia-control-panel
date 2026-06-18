import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { GET, POST } from '../users/route';
import {
  getRequest,
  postRequest,
  readJson,
} from '@/lib/__tests__/helpers/test-server';

type UserListBody = {
  data: Array<{
    username: string;
    assignedServices: string[];
    hasPartialProvisioning: boolean;
  }>;
  pagination: {
    total: number;
    totalPages: number;
  };
};

type UserErrorBody = {
  success: boolean;
  error: string;
};

/**
 * DB-path tests for /api/users (the validation paths live in users.test.ts).
 * Prisma model methods are stubbed by direct assignment on the shared singleton
 * so no real database is required.
 */
const orig = {
  findMany: prisma.user.findMany,
  count: prisma.user.count,
  create: prisma.user.create,
  execRawUnsafe: prisma.$executeRawUnsafe,
  execRaw: prisma.$executeRaw,
};

function fakeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    username: 'alice',
    displayName: null,
    isActive: true,
    isBlocked: false,
    trafficQuotaBytes: 0,
    speedLimitKbps: 0,
    protocols: [{ serviceType: 'AWG', isActive: true }],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  // POST writes an audit log; keep it off the real DB.
  prisma.$executeRawUnsafe = (async () => 1) as never;
  prisma.$executeRaw = (async () => 1) as never;
});
afterEach(() => {
  prisma.user.findMany = orig.findMany;
  prisma.user.count = orig.count;
  prisma.user.create = orig.create;
  prisma.$executeRawUnsafe = orig.execRawUnsafe;
  prisma.$executeRaw = orig.execRaw;
});

describe('GET /api/users — list (mocked DB)', () => {
  it('returns paginated users with their assigned services', async () => {
    prisma.user.findMany = (async () => [fakeUser()]) as never;
    prisma.user.count = (async () => 1) as never;

    const { status, body } = await readJson<UserListBody>(
      await GET(getRequest('/api/users', { page: 1, limit: 10 })),
    );
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.length, 1);
    assert.strictEqual(body.data[0].username, 'alice');
    assert.deepEqual(body.data[0].assignedServices, ['AWG']);
    assert.strictEqual(body.data[0].hasPartialProvisioning, false);
    assert.strictEqual(body.pagination.total, 1);
    assert.strictEqual(body.pagination.totalPages, 1);
  });

  it('propagates a search term into the result set', async () => {
    let capturedWhere: unknown;
    prisma.user.findMany = (async (args: { where: unknown }) => {
      capturedWhere = args.where;
      return [fakeUser({ username: 'alice' })];
    }) as never;
    prisma.user.count = (async () => 1) as never;

    await GET(getRequest('/api/users', { search: 'ali' }));
    assert.ok(capturedWhere, 'passed a where clause to findMany');
  });
});

describe('POST /api/users — duplicate handling (mocked DB)', () => {
  it('returns 409 when the username already exists (Prisma P2002)', async () => {
    prisma.user.create = (async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '7.8.0',
        },
      );
    }) as never;

    const { status, body } = await readJson<UserErrorBody>(
      await POST(
        postRequest('/api/users', {
          username: 'duplicate-user',
          password: 'valid-password-123',
        }),
      ),
    );
    assert.strictEqual(status, 409);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error, 'Resource already exists');
  });
});

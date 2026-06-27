import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GET } from '../stats/traffic/users/route';

type TopUserRow = {
  userId: number;
  username: string;
  totalBytesIn: bigint;
  totalBytesOut: bigint;
  totalBytes: bigint;
};

const originalQueryRaw = prisma.$queryRaw;

function stubTopUsersQuery(rows: TopUserRow[]) {
  prisma.$queryRaw = (() => Promise.resolve(rows)) as never;
}

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/stats/traffic/users');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

beforeEach(() => {
  stubTopUsersQuery([
    {
      userId: 1,
      username: 'alice',
      totalBytesIn: BigInt(5000),
      totalBytesOut: BigInt(3000),
      totalBytes: BigInt(8000),
    },
    {
      userId: 2,
      username: 'bob',
      totalBytesIn: BigInt(2000),
      totalBytesOut: BigInt(1000),
      totalBytes: BigInt(3000),
    },
  ]);
});

afterEach(() => {
  prisma.$queryRaw = originalQueryRaw;
});

describe('GET /api/stats/traffic/users', () => {
  it('returns top users with correct structure', async () => {
    const res = await GET(makeRequest({}));
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(body.data));
    assert.strictEqual(body.data.length, 2);

    const first = body.data[0];
    assert.strictEqual(first.userId, 1);
    assert.strictEqual(first.username, 'alice');
    assert.strictEqual(first.totalBytesIn, 5000);
    assert.strictEqual(first.totalBytesOut, 3000);
    assert.strictEqual(first.totalBytes, 8000);
  });

  it('converts bigint fields to numbers', async () => {
    const res = await GET(makeRequest({}));
    const body = await res.json();

    assert.strictEqual(typeof body.data[0].totalBytesIn, 'number');
    assert.strictEqual(typeof body.data[0].totalBytesOut, 'number');
    assert.strictEqual(typeof body.data[0].totalBytes, 'number');
  });

  it('accepts valid limit parameter', async () => {
    const res = await GET(makeRequest({ limit: '5' }));
    assert.strictEqual(res.status, 200);
  });

  it('accepts valid period values', async () => {
    for (const period of ['hourly', 'daily', 'weekly', 'monthly'] as const) {
      const res = await GET(makeRequest({ period }));
      assert.strictEqual(res.status, 200, `period=${period} should succeed`);
    }
  });

  it('rejects invalid period with 422', async () => {
    const res = await GET(makeRequest({ period: 'yearly' }));
    assert.strictEqual(res.status, 422);
  });

  it('rejects invalid limit (string) with 422', async () => {
    const res = await GET(makeRequest({ limit: 'abc' }));
    assert.strictEqual(res.status, 422);
  });

  it('rejects limit above max (100) with 422', async () => {
    const res = await GET(makeRequest({ limit: '200' }));
    assert.strictEqual(res.status, 422);
  });

  it('rejects limit below min (1) with 422', async () => {
    const res = await GET(makeRequest({ limit: '0' }));
    assert.strictEqual(res.status, 422);
  });

  it('returns 500 when database query fails', async () => {
    prisma.$queryRaw = (() => Promise.reject(new Error('db down'))) as never;
    const res = await GET(makeRequest({}));
    assert.strictEqual(res.status, 500);
  });
});

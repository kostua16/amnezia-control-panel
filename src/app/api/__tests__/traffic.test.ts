import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GET } from '../stats/traffic/route';

type TrafficRow = {
  bucket: string;
  bytesIn: bigint;
  bytesOut: bigint;
  userCount: bigint;
};

const originalQueryRaw = prisma.$queryRaw;

function stubTrafficQuery(rows: TrafficRow[]) {
  prisma.$queryRaw = (() => Promise.resolve(rows)) as never;
}

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/stats/traffic');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

beforeEach(() => {
  stubTrafficQuery([
    {
      bucket: '2025-01-15',
      bytesIn: BigInt(1024),
      bytesOut: BigInt(2048),
      userCount: BigInt(3),
    },
    {
      bucket: '2025-01-16',
      bytesIn: BigInt(512),
      bytesOut: BigInt(1024),
      userCount: BigInt(2),
    },
  ]);
});

afterEach(() => {
  prisma.$queryRaw = originalQueryRaw;
});

describe('GET /api/stats/traffic', () => {
  it('returns bucketed traffic data with correct structure', async () => {
    const res = await GET(makeRequest({}));
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.ok(body.data.buckets, 'response must include data.buckets');
    assert.strictEqual(body.data.buckets.length, 2);

    const first = body.data.buckets[0];
    assert.strictEqual(first.timestamp, '2025-01-15');
    assert.strictEqual(first.bytesIn, 1024);
    assert.strictEqual(first.bytesOut, 2048);
    assert.strictEqual(first.userCount, 3);
  });

  it('returns totalIn and totalOut aggregates', async () => {
    const res = await GET(makeRequest({}));
    const body = await res.json();

    assert.strictEqual(body.data.totalIn, 1536); // 1024 + 512
    assert.strictEqual(body.data.totalOut, 3072); // 2048 + 1024
  });

  it('defaults period to daily', async () => {
    // No period param — should default to 'daily' and succeed
    const res = await GET(makeRequest({}));
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

  it('rejects invalid userId with 422', async () => {
    const res = await GET(makeRequest({ userId: 'abc' }));
    assert.strictEqual(res.status, 422);
  });

  it('accepts valid userId', async () => {
    const res = await GET(makeRequest({ userId: '1' }));
    assert.strictEqual(res.status, 200);
  });

  it('returns 500 when database query fails', async () => {
    prisma.$queryRaw = (() => Promise.reject(new Error('db down'))) as never;
    const res = await GET(makeRequest({}));
    assert.strictEqual(res.status, 500);
  });
});

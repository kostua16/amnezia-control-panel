import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GET } from '../stats/traffic/route';
import { RETENTION_DAYS } from '@/lib/traffic-log-cleanup';

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

const SAMPLE_ROWS: TrafficRow[] = [
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
];

beforeEach(() => {
  stubTrafficQuery(SAMPLE_ROWS);
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

describe('GET /api/stats/traffic — date range safety', () => {
  it('returns 422 when requested range exceeds retention limit', async () => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - RETENTION_DAYS - 30);
    const to = new Date(now);

    const res = await GET(
      makeRequest({
        startDate: from.toISOString().split('T')[0],
        endDate: to.toISOString().split('T')[0],
      }),
    );

    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.ok(
      body.error.includes(`${RETENTION_DAYS}-day`),
      `error should mention ${RETENTION_DAYS}-day limit`,
    );
  });

  it('returns 200 when range is within the retention window', async () => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    const to = new Date(now);

    const res = await GET(
      makeRequest({
        startDate: from.toISOString().split('T')[0],
        endDate: to.toISOString().split('T')[0],
      }),
    );

    assert.strictEqual(res.status, 200);
  });

  it('returns 200 when no dates provided (defaults to retention window)', async () => {
    const res = await GET(makeRequest({}));
    assert.strictEqual(res.status, 200);
  });

  it('omits X-Result-Truncated header when results are under limit', async () => {
    const res = await GET(makeRequest({}));
    assert.strictEqual(res.headers.get('X-Result-Truncated'), null);
  });

  it('sets X-Result-Truncated header when results hit the limit', async () => {
    // Stub 10000 rows to simulate a truncated result set
    const manyRows: TrafficRow[] = Array.from({ length: 10000 }, (_, i) => ({
      bucket: `2025-01-${String(i + 1).padStart(2, '0')}`,
      bytesIn: BigInt(100),
      bytesOut: BigInt(200),
      userCount: BigInt(1),
    }));
    stubTrafficQuery(manyRows);

    const res = await GET(makeRequest({}));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('X-Result-Truncated'), 'true');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../health/route';

const VALID_STATUSES = ['ok', 'degraded', 'unhealthy'] as const;

describe('GET /api/health', () => {
  it('returns a structured report with per-subsystem checks', async () => {
    const res = await GET();
    const body = await res.json();

    assert.ok(
      (VALID_STATUSES as readonly string[]).includes(body.status),
      `unexpected status: ${body.status}`,
    );
    assert.ok(body.checks, 'response must include a checks object');

    assert.strictEqual(typeof body.checks.database.ok, 'boolean');
    assert.strictEqual(typeof body.checks.geoip.ok, 'boolean');
    assert.strictEqual(typeof body.checks.geoip.loaded, 'boolean');
    assert.strictEqual(typeof body.checks.geoip.stale, 'boolean');
    assert.strictEqual(typeof body.checks.websocket.ok, 'boolean');
    assert.strictEqual(typeof body.checks.websocket.initialized, 'boolean');
  });

  it('maps status to the correct HTTP code (503 only when unhealthy)', async () => {
    const res = await GET();
    const body = await res.json();
    if (body.status === 'unhealthy') {
      assert.strictEqual(res.status, 503);
    } else {
      assert.strictEqual(res.status, 200);
    }
  });

  it('includes a valid ISO 8601 timestamp', async () => {
    const res = await GET();
    const body = await res.json();
    assert.ok(typeof body.timestamp === 'string');
    assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  });

  it('does not expose raw DB error details when the database is unreachable', async () => {
    const res = await GET();
    const body = await res.json();
    // When the DB check fails the error must be the sanitised sentinel string,
    // never a raw Prisma / adapter message that could leak connection strings.
    if (!body.checks.database.ok) {
      assert.strictEqual(
        body.checks.database.error,
        'database unreachable',
        'raw Prisma error must not be exposed to callers',
      );
    }
  });
});

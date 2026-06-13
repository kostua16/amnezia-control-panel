import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../health/route';

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await GET();
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
  });

  it('includes a valid ISO 8601 timestamp', async () => {
    const res = await GET();
    const body = await res.json();
    assert.ok(typeof body.timestamp === 'string');
    assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  });
});

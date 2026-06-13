import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../auth/me/route';

function meRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/auth/me', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/auth/me — reads identity from middleware claim headers', () => {
  it('returns the user from x-user-id / x-user-name headers', async () => {
    const res = await GET(
      meRequest({ 'x-user-id': 'admin-1', 'x-user-name': 'admin' }),
    );
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.deepEqual(body, { user: { id: 'admin-1', username: 'admin' } });
  });

  it('returns 401 when the middleware did not attach claims', async () => {
    const res = await GET(meRequest());
    const body = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(body.error, 'Not authenticated');
  });

  it('returns 401 when only one claim header is present', async () => {
    const res = await GET(meRequest({ 'x-user-id': 'admin-1' }));
    assert.strictEqual(res.status, 401);
  });
});

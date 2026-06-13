import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET, POST } from '../users/route';

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getRequest(query: string) {
  return new NextRequest(`http://localhost/api/users?${query}`);
}

describe('POST /api/users — validation', () => {
  it('rejects a username that is too short with 422', async () => {
    const res = await POST(
      postRequest({ username: 'ab', password: 'validpassword123' }),
    );
    const body = await res.json();
    assert.strictEqual(res.status, 422);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error, 'Username must be at least 3 characters');
  });

  it('rejects a password that is too short with 422', async () => {
    const res = await POST(
      postRequest({ username: 'validuser', password: 'short' }),
    );
    const body = await res.json();
    assert.strictEqual(res.status, 422);
    assert.strictEqual(body.error, 'Password must be at least 12 characters');
  });

  it('rejects an unknown service enum value with 422', async () => {
    const res = await POST(
      postRequest({
        username: 'validuser',
        password: 'validpassword123',
        services: ['NOT_A_SERVICE'],
      }),
    );
    const body = await res.json();
    assert.strictEqual(res.status, 422);
    assert.strictEqual(body.success, false);
  });

  it('rejects an empty body with 422', async () => {
    const res = await POST(postRequest({}));
    const body = await res.json();
    assert.strictEqual(res.status, 422);
    assert.strictEqual(body.success, false);
  });
});

describe('GET /api/users — validation', () => {
  it('rejects an out-of-range page with 422', async () => {
    const res = await GET(getRequest('page=0'));
    const body = await res.json();
    assert.strictEqual(res.status, 422);
    assert.strictEqual(body.error, 'Invalid query parameters');
  });

  it('rejects an unknown sortBy value with 422', async () => {
    const res = await GET(getRequest('sortBy=bogus'));
    const body = await res.json();
    assert.strictEqual(res.status, 422);
    assert.strictEqual(body.error, 'Invalid query parameters');
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { middleware } from '../../../middleware';

const TEST_JWT_SECRET = 'test-middleware-secret-key-for-integration-test';
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

before(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

after(() => {
  process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
});

/**
 * Mint a real HS256 JWT carrying the given claims, signed with the secret
 * the middleware reads from process.env.JWT_SECRET.
 */
async function mintToken(claims: {
  userId: string;
  username: string;
}): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
}

/**
 * Build a NextRequest to a protected API route, optionally carrying a valid
 * auth-token cookie and/or client-supplied identity headers.
 */
function apiRequest(
  opts: {
    token?: string;
    userId?: string;
    username?: string;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.token) {
    headers['Cookie'] = `auth-token=${opts.token}`;
  }
  // Client-supplied identity headers (the attack vector under test).
  if (opts.userId) headers['x-user-id'] = opts.userId;
  if (opts.username) headers['x-user-name'] = opts.username;

  return new NextRequest('http://localhost/api/users', { headers });
}

describe('middleware — claim-header overwrite on valid JWT', () => {
  it('overwrites client-supplied x-user-id / x-user-name with JWT claims', async () => {
    const token = await mintToken({
      userId: 'real-admin',
      username: 'real-admin',
    });

    const res = await middleware(
      apiRequest({
        token,
        userId: 'spoofed-id',
        username: 'attacker',
      }),
    );

    // NextResponse.next() surfaces forwarded request headers under the
    // x-middleware-request- prefix (verified by probe in Next 16.2.9).
    assert.strictEqual(
      res.headers.get('x-middleware-request-x-user-id'),
      'real-admin',
      'must carry JWT userId, not the spoofed value',
    );
    assert.strictEqual(
      res.headers.get('x-middleware-request-x-user-name'),
      'real-admin',
      'must carry JWT username, not the spoofed value',
    );
  });

  it('returns 401 and no claim headers when token is missing', async () => {
    const res = await middleware(apiRequest());

    assert.strictEqual(res.status, 401);
    assert.strictEqual(
      res.headers.get('x-middleware-request-x-user-id'),
      null,
      'no claim headers should be forwarded without a valid token',
    );
  });
});

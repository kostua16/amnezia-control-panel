import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { POST } from '../auth/login/route';
import { postRequest, readJson } from '@/lib/__tests__/helpers/test-server';

// The login handler reads JWT_SECRET at call time; provide one for tests.
process.env.JWT_SECRET = 'test-jwt-secret-for-route-tests';

const LOGIN_PATH = '/api/auth/login';

type AdminRow = {
  id: number;
  username: string;
  password: string;
};

type LoginErrorBody = {
  details?: unknown;
  error: string;
};

type LoginSuccessBody = {
  user: { username: string };
};

// Save originals so stubs never leak across files in the same worker.
const originalFindUnique = prisma.admin.findUnique;

function stubAdminLookup(byUsername: (username: string) => AdminRow | null) {
  prisma.admin.findUnique = ((args: { where: { username: string } }) =>
    Promise.resolve(byUsername(args.where.username))) as never;
}

beforeEach(() => {
  // seedAdmin() queries `username: 'admin'`; answer it so seeding is a no-op.
  stubAdminLookup((u) =>
    u === 'admin' ? { id: 0, username: 'admin', password: 'x' } : null,
  );
});
afterEach(() => {
  prisma.admin.findUnique = originalFindUnique;
});

describe('POST /api/auth/login', () => {
  it('rejects missing fields with 422', async () => {
    const { status, body } = await readJson<LoginErrorBody>(
      await POST(postRequest(LOGIN_PATH, { username: '' })),
    );
    assert.strictEqual(status, 422);
    assert.ok(body.details, 'includes field error details');
  });

  it('rejects an unknown user with 401', async () => {
    const { status, body } = await readJson<LoginErrorBody>(
      await POST(
        postRequest(LOGIN_PATH, {
          username: 'ghost',
          password: 'whatever-password',
        }),
      ),
    );
    assert.strictEqual(status, 401);
    assert.strictEqual(body.error, 'Invalid credentials');
  });

  it('rejects a wrong password with 401', async () => {
    const hash = await bcrypt.hash('correct-password-123', 4);
    stubAdminLookup((u) =>
      u === 'admin' ? { id: 0, username: 'admin', password: 'x' } : null,
    );
    // Override lookup for the login user only; keep seed no-op.
    prisma.admin.findUnique = ((args: { where: { username: string } }) =>
      Promise.resolve(
        args.where.username === 'realadmin'
          ? { id: 7, username: 'realadmin', password: hash }
          : args.where.username === 'admin'
            ? { id: 0, username: 'admin', password: 'x' }
            : null,
      )) as never;

    const { status, body } = await readJson<LoginErrorBody>(
      await POST(
        postRequest(LOGIN_PATH, {
          username: 'realadmin',
          password: 'wrong-password-123',
        }),
      ),
    );
    assert.strictEqual(status, 401);
    assert.strictEqual(body.error, 'Invalid credentials');
  });

  it('issues a session cookie on valid credentials (200)', async () => {
    const password = 'valid-password-123';
    const hash = await bcrypt.hash(password, 4);
    prisma.admin.findUnique = ((args: { where: { username: string } }) =>
      Promise.resolve(
        args.where.username === 'realadmin'
          ? { id: 7, username: 'realadmin', password: hash }
          : args.where.username === 'admin'
            ? { id: 0, username: 'admin', password: 'x' }
            : null,
      )) as never;

    const res = await POST(
      postRequest(LOGIN_PATH, { username: 'realadmin', password }),
    );
    const body = (await res.json()) as LoginSuccessBody;
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.user.username, 'realadmin');

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'sets a Set-Cookie header');
    assert.ok(
      setCookie.includes('auth-token='),
      'cookie is the auth-token session cookie',
    );
    assert.ok(
      setCookie.toLowerCase().includes('httponly'),
      'session cookie is HttpOnly',
    );
  });
});

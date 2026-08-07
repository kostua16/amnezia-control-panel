import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { apiHandler, toErrorResponse } from '../api-handler';
import { BodySizeLimitError } from '../parse-body';
import { NextRequest } from 'next/server';

function makePrismaError(code: string, message = 'constraint failure') {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '7.8.0',
  });
}

describe('toErrorResponse', () => {
  it('maps Prisma P2002 (unique violation) to 409', async () => {
    const res = toErrorResponse(makePrismaError('P2002'), 'api/users');
    const body = await res.json();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error, 'Resource already exists');
  });

  it('maps Prisma P2025 (not found) to 404', async () => {
    const res = toErrorResponse(makePrismaError('P2025'), 'api/users');
    const body = await res.json();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(body.error, 'Resource not found');
  });

  it('maps other Prisma errors to 500', async () => {
    const res = toErrorResponse(makePrismaError('P2003'), 'api/users');
    const body = await res.json();
    assert.strictEqual(res.status, 500);
    assert.strictEqual(body.error, 'Database request failed');
  });

  it('maps ZodError to 422 with the first field message', async () => {
    const schema = z.object({ username: z.string().min(3, 'too short') });
    const result = schema.safeParse({ username: 'a' });
    assert.ok(!result.success);
    const res = toErrorResponse(result.error, 'api/users');
    const body = await res.json();
    assert.strictEqual(res.status, 422);
    assert.strictEqual(body.error, 'too short');
  });

  it('maps unknown errors to 500 with a generic message', async () => {
    const res = toErrorResponse(new Error('boom'), 'api/users');
    const body = await res.json();
    assert.strictEqual(res.status, 500);
    assert.strictEqual(body.error, 'Internal server error');
  });
});

describe('apiHandler', () => {
  it('passes through a successful response unchanged', async () => {
    const handler = apiHandler(async () => {
      return Response.json({ ok: true }, { status: 200 });
    }, 'api/test');
    const res = await handler();
    assert.strictEqual(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it('converts a thrown Prisma P2002 into a 409 response', async () => {
    const handler = apiHandler(async () => {
      throw makePrismaError('P2002');
    }, 'api/test');
    const res = await handler();
    const body = await res.json();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(body.success, false);
  });

  it('converts a thrown ZodError into a 422 response', async () => {
    const handler = apiHandler(async () => {
      const schema = z.object({ email: z.string().email('bad email') });
      schema.parse({ email: 'no' }); // throws ZodError
      return Response.json({});
    }, 'api/test');
    const res = await handler();
    const body = await res.json();
    assert.strictEqual(res.status, 422);
    assert.strictEqual(body.error, 'bad email');
  });

  it('converts an unknown thrown error into a 500 response', async () => {
    const handler = apiHandler(async () => {
      throw new Error('unexpected');
    }, 'api/test');
    const res = await handler();
    const body = await res.json();
    assert.strictEqual(res.status, 500);
    assert.strictEqual(body.error, 'Internal server error');
  });

  it('forwards the NextRequest argument to the wrapped handler', async () => {
    const handler = apiHandler(async (request: NextRequest) => {
      return Response.json({ url: request.url });
    }, 'api/test');
    const req = new NextRequest('https://example.com/api/test');
    const res = await handler(req);
    assert.strictEqual(res.status, 200);
    assert.deepEqual(await res.json(), { url: 'https://example.com/api/test' });
  });

  it('converts a BodySizeLimitError into a 413 response', async () => {
    const handler = apiHandler(async () => {
      throw new BodySizeLimitError(1024, 2048);
    }, 'api/test');
    const res = await handler();
    const body = await res.json();
    assert.strictEqual(res.status, 413);
    assert.strictEqual(body.success, false);
    assert.ok(body.error.includes('exceeds limit'));
  });
});

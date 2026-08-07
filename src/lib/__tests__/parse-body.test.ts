import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { readBody, parseBody, BodySizeLimitError } from '../parse-body';

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('https://example.com/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('readBody', () => {
  it('reads a small body within the limit', async () => {
    const req = makeRequest({ name: 'test' });
    const raw = await readBody(req);
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, { name: 'test' });
  });

  it('rejects a body that exceeds the size limit', async () => {
    // Build a payload larger than 256 bytes
    const bigObj: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      bigObj[`key${i}`] = 'x'.repeat(10);
    }
    const body = JSON.stringify(bigObj);
    assert.ok(
      body.length > 256,
      `test body should exceed 256 bytes (got ${body.length})`,
    );

    const req = makeRequest(bigObj);
    await assert.rejects(
      () => readBody(req, 256),
      (err: unknown) => {
        assert.ok(err instanceof BodySizeLimitError);
        assert.ok(err.limit <= 256);
        return true;
      },
    );
  });

  it('accepts a body exactly at the limit', async () => {
    const small = { a: 'b' };
    const body = JSON.stringify(small);
    const req = makeRequest(small);
    const raw = await readBody(req, body.length);
    assert.ok(raw.length <= body.length);
  });
});

describe('parseBody', () => {
  const schema = z.object({
    name: z.string().min(1),
    count: z.number().int().positive(),
  });

  it('parses and validates a valid body', async () => {
    const req = makeRequest({ name: 'hello', count: 5 });
    const result = await parseBody(req, schema);
    assert.deepEqual(result, { name: 'hello', count: 5 });
  });

  it('throws ZodError for invalid payload', async () => {
    const req = makeRequest({ name: '', count: -1 });
    await assert.rejects(
      () => parseBody(req, schema),
      (err: unknown) => {
        assert.ok(err instanceof z.ZodError);
        return true;
      },
    );
  });

  it('throws BodySizeLimitError for oversized payload', async () => {
    const bigObj: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      bigObj[`field${i}`] = 'padding';
    }
    const req = makeRequest(bigObj);
    await assert.rejects(
      () => parseBody(req, schema, 128),
      (err: unknown) => {
        assert.ok(err instanceof BodySizeLimitError);
        return true;
      },
    );
  });
});

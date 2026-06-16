import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { httpClient, httpGetJson, HttpError } from '../http-client';

const originalFetch = globalThis.fetch;

function mockFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
) {
  globalThis.fetch = mock.fn(
    async (url: string | URL | Request, init?: RequestInit) =>
      impl(url.toString(), init),
  ) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('httpClient', () => {
  it('returns the Response on success without retrying', async () => {
    let callCount = 0;
    mockFetch(async () => {
      callCount++;
      return new Response('ok', { status: 200 });
    });

    const res = await httpClient('https://example.test/x', { retries: 1 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(callCount, 1);
  });

  it('retries once on 5xx then succeeds', async () => {
    const statuses: number[] = [];
    mockFetch(async () => {
      const status = statuses.length === 0 ? 500 : 200;
      statuses.push(status);
      return new Response('', { status });
    });

    const res = await httpClient('https://example.test/x', {
      retries: 1,
      retryDelayMs: 1,
    });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(statuses, [500, 200]);
  });

  it('returns the final 5xx Response when retries are exhausted', async () => {
    let callCount = 0;
    mockFetch(async () => {
      callCount++;
      return new Response('boom', { status: 503 });
    });

    const res = await httpClient('https://example.test/x', {
      retries: 1,
      retryDelayMs: 1,
    });

    assert.strictEqual(res.status, 503);
    assert.strictEqual(callCount, 2);
  });

  it('does not retry when retries: 0 (preserves caller retry loops)', async () => {
    let callCount = 0;
    mockFetch(async () => {
      callCount++;
      return new Response('', { status: 500 });
    });

    const res = await httpClient('https://example.test/x', { retries: 0 });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(callCount, 1);
  });

  it('throws HttpError with timedOut=true on timeout (retries exhausted)', async () => {
    mockFetch(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'TimeoutError';
      throw err;
    });

    await assert.rejects(
      () => httpClient('https://example.test/x', { retries: 0 }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.strictEqual(err.timedOut, true);
        assert.strictEqual(err.status, null);
        assert.strictEqual(err.url, 'https://example.test/x');
        assert.strictEqual(err.method, 'GET');
        return true;
      },
    );
  });

  it('enriches network errors with method and url after retries exhaust', async () => {
    mockFetch(async () => {
      throw new Error('ECONNRESET');
    });

    await assert.rejects(
      () =>
        httpClient('https://example.test/y', {
          method: 'POST',
          retries: 1,
          retryDelayMs: 1,
        }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.strictEqual(err.method, 'POST');
        assert.ok(err.message.includes('https://example.test/y'));
        return true;
      },
    );
  });
});

describe('httpGetJson', () => {
  it('parses a 2xx JSON body', async () => {
    mockFetch(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const body = await httpGetJson<{ ok: boolean }>('https://example.test/j');

    assert.strictEqual(body.ok, true);
  });

  it('throws HttpError on non-2xx', async () => {
    mockFetch(async () => new Response('', { status: 404 }));

    await assert.rejects(
      () => httpGetJson('https://example.test/missing'),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.strictEqual(err.status, 404);
        return true;
      },
    );
  });
});

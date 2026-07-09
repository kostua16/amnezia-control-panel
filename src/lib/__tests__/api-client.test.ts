import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiMutate } from '../api-client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiMutate', () => {
  it('does not attach a timeout signal by default', async () => {
    let signal: RequestInit['signal'] | undefined;
    globalThis.fetch = (async (_input, init) => {
      signal = init?.signal;
      return jsonResponse({ success: true });
    }) as typeof fetch;

    await apiMutate<{ success: boolean }>('/api/users', 'POST', {
      username: 'alice',
    });

    assert.equal(signal, undefined);
  });

  it('attaches a timeout signal when a timeout is requested', async () => {
    let signal: RequestInit['signal'] | undefined;
    globalThis.fetch = (async (_input, init) => {
      signal = init?.signal;
      return jsonResponse({ success: true });
    }) as typeof fetch;

    await apiMutate<{ success: boolean }>(
      '/api/users',
      'POST',
      undefined,
      1000,
    );

    assert.ok(signal instanceof AbortSignal);
  });
});

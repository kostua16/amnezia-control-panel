import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyAwgConfig, applyThreeXuiConfig } from '../config-applier';
import { signPayload } from '../hmac';
import type { PanelSyncPayload } from '@/types/panel-sync';

describe('applyAwgConfig', () => {
  const originalFetch = globalThis.fetch;
  const testApiKey = 'test-api-key-abc123';

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const testPeers: PanelSyncPayload['wireguardPeers'] = [
    {
      publicKey: 'testpubkey=',
      allowedIPs: '10.0.0.2/32',
      endpoint: '192.168.1.1:51820',
      persistentKeepalive: 25,
    },
  ];

  it('sends X-API-Key and X-Signature headers to /api/sync/apply', async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mock.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              applied: true,
              configVersion: 1,
              service: 'awg',
              message: 'OK',
            },
          }),
          { status: 200 },
        );
      },
    );

    await applyAwgConfig(
      'https://panel.example.com',
      'TestPanel',
      testApiKey,
      testPeers,
    );

    assert.ok(capturedInit);
    const headers = capturedInit!.headers as Record<string, string>;
    assert.equal(headers['X-API-Key'], testApiKey);
    assert.ok(headers['X-Signature']);
    assert.match(headers['X-Signature'], /^[a-f0-9]{64}$/);
    assert.equal(headers['Content-Type'], 'application/json');
  });

  it('returns success when route returns { success: true, data: { applied: true } }', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            applied: true,
            configVersion: 5,
            service: 'awg',
            message: 'Applied',
          },
        }),
        { status: 200 },
      );
    });

    const result = await applyAwgConfig(
      'https://panel.example.com',
      'TestPanel',
      testApiKey,
      testPeers,
    );
    assert.equal(result.success, true);
    assert.equal(result.service, 'awg');
    assert.equal(result.error, null);
  });

  it('returns failure when route returns { success: true, data: { applied: false } }', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            applied: false,
            configVersion: 5,
            service: 'awg',
            message: 'Invalid config',
          },
        }),
        { status: 200 },
      );
    });

    const result = await applyAwgConfig(
      'https://panel.example.com',
      'TestPanel',
      testApiKey,
      testPeers,
    );
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('returns 401 when missing auth headers (route rejects)', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing X-API-Key or X-Signature header',
        }),
        { status: 401 },
      );
    });

    const result = await applyAwgConfig(
      'https://panel.example.com',
      'TestPanel',
      testApiKey,
      testPeers,
    );
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('HMAC signature is verifiable with the same API key', async () => {
    let capturedBody: string | undefined;
    let capturedSignature: string | undefined;
    globalThis.fetch = mock.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = init!.headers as Record<string, string>;
        capturedSignature = headers['X-Signature'];
        capturedBody = init!.body as string;
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              applied: true,
              configVersion: 1,
              service: 'awg',
              message: 'OK',
            },
          }),
          { status: 200 },
        );
      },
    );

    await applyAwgConfig(
      'https://panel.example.com',
      'TestPanel',
      testApiKey,
      testPeers,
    );
    const payload = JSON.parse(capturedBody!);
    assert.equal(signPayload(payload, testApiKey), capturedSignature);
  });
});

describe('applyThreeXuiConfig', () => {
  const originalFetch = globalThis.fetch;
  const testApiKey = 'test-api-key-xyz789';

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const testRules: PanelSyncPayload['routingRules'] = [
    { type: 'ip', value: '0.0.0.0/0', outboundTag: 'direct', priority: 0 },
  ];

  it('sends X-API-Key and X-Signature headers', async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mock.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              applied: true,
              configVersion: 1,
              service: 'three_xui',
              message: 'OK',
            },
          }),
          { status: 200 },
        );
      },
    );

    await applyThreeXuiConfig(
      'https://panel.example.com',
      'TestPanel',
      testApiKey,
      testRules,
    );

    assert.ok(capturedInit);
    const headers = capturedInit!.headers as Record<string, string>;
    assert.equal(headers['X-API-Key'], testApiKey);
    assert.ok(headers['X-Signature']);
  });

  it('returns success when route returns nested applied: true', async () => {
    globalThis.fetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            applied: true,
            configVersion: 3,
            service: 'three_xui',
            message: 'Rules applied',
          },
        }),
        { status: 200 },
      );
    });

    const result = await applyThreeXuiConfig(
      'https://panel.example.com',
      'TestPanel',
      testApiKey,
      testRules,
    );
    assert.equal(result.success, true);
    assert.equal(result.service, 'three_xui');
  });
});

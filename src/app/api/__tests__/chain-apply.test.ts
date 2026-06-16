import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../chains/apply/route';
import { postRequest, readJson } from '@/lib/__tests__/helpers/test-server';

const PATH = '/api/chains/apply';

type ChainApplyErrorBody = {
  success?: boolean;
  error: string;
};

describe('POST /api/chains/apply — validation', () => {
  it('rejects split routing without direct GeoIP zones with 422', async () => {
    const { status, body } = await readJson<ChainApplyErrorBody>(
      await POST(
        postRequest(PATH, {
          templateId: 'split-routing',
          serverMapping: { 0: 1, 1: 2 },
        }),
      ),
    );

    assert.strictEqual(status, 422);
    assert.strictEqual(
      body.error,
      'Split routing requires at least one direct GeoIP zone tag',
    );
  });
});

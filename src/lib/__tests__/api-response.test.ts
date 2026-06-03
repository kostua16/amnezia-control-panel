import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  success,
  error,
  firstZodError,
  validationError,
} from '../api-response';
import { z } from 'zod';

describe('api-response', () => {
  describe('success', () => {
    it('returns 200 with success:true and data', async () => {
      const res = success({ id: 1 });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.deepEqual(body, { success: true, data: { id: 1 } });
    });

    it('accepts custom status code', () => {
      const res = success(null, 'created', 201);
      assert.strictEqual(res.status, 201);
    });

    it('includes message when provided', async () => {
      const body = await success({ x: 1 }, 'ok').json();
      assert.strictEqual(body.message, 'ok');
    });
  });

  describe('error', () => {
    it('returns 500 with success:false and error message', async () => {
      const res = error('something failed');
      const body = await res.json();
      assert.strictEqual(res.status, 500);
      assert.deepEqual(body, { success: false, error: 'something failed' });
    });

    it('accepts custom status code', () => {
      const res = error('not found', 404);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('firstZodError', () => {
    it('returns the first issue message', () => {
      const schema = z.object({ name: z.string().min(1) });
      const result = schema.safeParse({ name: '' });
      if (!result.success) {
        const msg = firstZodError(result.error);
        assert.ok(msg.length > 0);
        assert.ok(msg !== 'Invalid request body');
      }
    });

    it('returns fallback when no issues exist', () => {
      assert.strictEqual(
        firstZodError(new z.ZodError([])),
        'Invalid request body',
      );
    });
  });

  describe('validationError', () => {
    it('returns 422 with first Zod error message', async () => {
      const schema = z.object({ email: z.string().email() });
      const result = schema.safeParse({ email: 'bad' });
      if (!result.success) {
        const res = validationError(result.error);
        assert.strictEqual(res.status, 422);
        const body = await res.json();
        assert.strictEqual(body.success, false);
      }
    });
  });
});

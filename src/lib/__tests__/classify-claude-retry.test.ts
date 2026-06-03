import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  classifyClaudeRetry,
  hasSuccessfulResult,
  isRateLimitOrOverloadText,
} = require('../../../.github/workflows/scripts/classify-claude-retry.cjs');

describe('classifyClaudeRetry', () => {
  it('retries HTTP 429 as rate_limited', () => {
    const result = classifyClaudeRetry({ httpCode: '429', attempt: '1' });

    assert.equal(result.httpCode, '429');
    assert.equal(result.isRateLimited, true);
    assert.equal(result.shouldRetry, true);
    assert.equal(result.retryReason, 'rate_limited');
    assert.match(result.message, /HTTP 429/);
  });

  it('retries HTTP 529 as rate_limited', () => {
    const result = classifyClaudeRetry({ httpCode: '529', attempt: '2' });

    assert.equal(result.httpCode, '529');
    assert.equal(result.isRateLimited, true);
    assert.equal(result.shouldRetry, true);
    assert.equal(result.retryReason, 'rate_limited');
    assert.match(result.message, /HTTP 529/);
    assert.match(result.message, /Final retry/);
  });

  it('retries execution JSON 529 evidence even when the API probe returns HTTP 200', () => {
    const result = classifyClaudeRetry({
      httpCode: '200',
      attempt: '1',
      executionText: JSON.stringify({
        type: 'result',
        is_error: true,
        result:
          'API Error: 529 {"error":"[1305][service temporarily overloaded]"}',
      }),
    });

    assert.equal(result.httpCode, '200');
    assert.equal(result.isRateLimited, true);
    assert.equal(result.shouldRetry, true);
    assert.equal(result.retryReason, 'rate_limited');
    assert.match(result.message, /ZAI 529\/overload evidence/);
  });

  it('retries missing structured output after a successful JSON-schema execution result', () => {
    const result = classifyClaudeRetry({
      httpCode: '200',
      attempt: '1',
      jsonSchemaEnabled: 'true',
      executionText: JSON.stringify({
        type: 'result',
        is_error: false,
        subtype: 'success',
      }),
    });

    assert.equal(hasSuccessfulResult(JSON.stringify({ type: 'result' })), true);
    assert.equal(result.isRateLimited, false);
    assert.equal(result.shouldRetry, true);
    assert.equal(result.retryReason, 'missing_structured_output');
  });

  it('does not retry non-retryable failures', () => {
    const result = classifyClaudeRetry({
      httpCode: '200',
      attempt: '1',
      executionText: JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'Action failed with error: validation failed',
      }),
    });

    assert.equal(isRateLimitOrOverloadText('validation failed'), false);
    assert.equal(result.isRateLimited, false);
    assert.equal(result.shouldRetry, false);
    assert.equal(result.retryReason, 'non_retryable');
    assert.match(result.message, /non-retryable/);
  });
});

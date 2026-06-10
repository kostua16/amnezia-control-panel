import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enrichError } from '../error-reporter';

describe('enrichError', () => {
  it('classifies timeout errors', () => {
    const result = enrichError('Connection ETIMEDOUT after 30s', 'Panel1');
    assert.equal(result.type, 'connection_timeout');
    assert.ok(result.message.includes('Panel1'));
    assert.ok(result.recommendation.includes('Tailscale'));
    assert.ok(result.knownFix);
  });

  it('classifies auth failure errors (401)', () => {
    const result = enrichError('HTTP 401 Unauthorized', 'Panel2');
    assert.equal(result.type, 'auth_failure');
    assert.ok(result.message.includes('Panel2'));
    assert.ok(result.knownFix?.includes('API key'));
  });

  it('classifies auth failure errors (invalid signature)', () => {
    const result = enrichError('Invalid signature provided', 'Panel3');
    assert.equal(result.type, 'auth_failure');
  });

  it('classifies invalid config errors', () => {
    const result = enrichError(
      'Configuration validation failed: bad value',
      'Panel4',
    );
    assert.equal(result.type, 'invalid_config');
  });

  it('classifies docker errors', () => {
    const result = enrichError('Container is not running', 'Panel5');
    assert.equal(result.type, 'docker_error');
    assert.ok(result.knownFix?.includes('docker'));
  });

  it('classifies service errors', () => {
    const result = enrichError('amneziawg: not found', 'Panel6');
    assert.equal(result.type, 'service_error');
  });

  it('falls back to unknown for unrecognized errors', () => {
    const result = enrichError('Something completely unexpected', 'Panel7');
    assert.equal(result.type, 'unknown');
    assert.ok(result.message.includes('Panel7'));
    assert.equal(result.knownFix, null);
  });

  it('preserves raw error in output', () => {
    const raw = 'ECONNREFUSED on port 443';
    const result = enrichError(raw, 'Panel8');
    assert.equal(result.rawError, raw);
  });

  it('classifies ECONNREFUSED as a connection timeout', () => {
    const result = enrichError('ECONNREFUSED on port 443', 'Panel8');
    assert.equal(result.type, 'connection_timeout');
    assert.ok(result.recommendation.includes('Tailscale'));
  });

  it('classifies 403 as auth failure', () => {
    const result = enrichError('HTTP 403 Forbidden', 'Panel11');
    assert.equal(result.type, 'auth_failure');
  });

  it('classifies command not found as service error', () => {
    const result = enrichError('wg: command not found', 'Panel12');
    assert.equal(result.type, 'service_error');
  });

  it('classifies Docker container not found as docker error', () => {
    const result = enrichError('Docker container not found: 3x-ui', 'Panel13');
    assert.equal(result.type, 'docker_error');
  });

  it('pattern matching is case-insensitive', () => {
    const result = enrichError('TIMEOUT occurred', 'Panel9');
    assert.equal(result.type, 'connection_timeout');
  });

  it('returns structured result for empty rawError', () => {
    const result = enrichError('', 'Panel10');
    assert.equal(result.type, 'unknown');
    assert.ok(result.message.includes('Panel10'));
    assert.equal(result.rawError, '');
    assert.equal(result.knownFix, null);
    assert.ok(result.recommendation.length > 0);
  });

  it('always includes all required fields', () => {
    const cases = [
      'ETIMEDOUT',
      '403 Forbidden',
      'validation failed',
      'docker container not found',
      'service not found',
      'random gibberish',
    ];
    for (const raw of cases) {
      const result = enrichError(raw, 'TestPanel');
      assert.ok('type' in result, `Missing type for: ${raw}`);
      assert.ok('message' in result, `Missing message for: ${raw}`);
      assert.ok(
        'recommendation' in result,
        `Missing recommendation for: ${raw}`,
      );
      assert.ok('knownFix' in result, `Missing knownFix for: ${raw}`);
      assert.ok('rawError' in result, `Missing rawError for: ${raw}`);
      assert.equal(result.rawError, raw);
    }
  });
});

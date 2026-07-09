import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { isValidOrigin, MUTATING_METHODS } from '../csrf';

describe('isValidOrigin', () => {
  const panelUrl = 'http://localhost:3333';

  it('allows request with no Origin header (same-origin browser)', () => {
    const req = new NextRequest(`${panelUrl}/api/users`, {
      method: 'POST',
    });
    assert.strictEqual(isValidOrigin(req), true);
  });

  it('allows request with matching Origin header', () => {
    const req = new NextRequest(`${panelUrl}/api/users`, {
      method: 'POST',
      headers: { Origin: panelUrl },
    });
    assert.strictEqual(isValidOrigin(req), true);
  });

  it('rejects request with mismatched Origin header', () => {
    const req = new NextRequest(`${panelUrl}/api/users`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.strictEqual(isValidOrigin(req), false);
  });

  it('rejects request with different port in Origin', () => {
    const req = new NextRequest(`${panelUrl}/api/users`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:9999' },
    });
    assert.strictEqual(isValidOrigin(req), false);
  });

  it('handles https panel origin correctly', () => {
    const req = new NextRequest('https://panel.example.com/api/users', {
      method: 'POST',
      headers: { Origin: 'https://panel.example.com' },
    });
    assert.strictEqual(isValidOrigin(req), true);
  });

  it('rejects http Origin when panel is https', () => {
    const req = new NextRequest('https://panel.example.com/api/users', {
      method: 'POST',
      headers: { Origin: 'http://panel.example.com' },
    });
    assert.strictEqual(isValidOrigin(req), false);
  });
});

describe('MUTATING_METHODS', () => {
  it('contains POST, PUT, DELETE, PATCH', () => {
    assert.ok(MUTATING_METHODS.has('POST'));
    assert.ok(MUTATING_METHODS.has('PUT'));
    assert.ok(MUTATING_METHODS.has('DELETE'));
    assert.ok(MUTATING_METHODS.has('PATCH'));
  });

  it('does not contain GET or HEAD', () => {
    assert.ok(!MUTATING_METHODS.has('GET'));
    assert.ok(!MUTATING_METHODS.has('HEAD'));
    assert.ok(!MUTATING_METHODS.has('OPTIONS'));
  });
});

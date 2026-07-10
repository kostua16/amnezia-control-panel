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

  it('allows same-host Origin across scheme (TLS-terminating proxy)', () => {
    // Behind a TLS-terminating reverse proxy the app sees http while the
    // browser sends https for the same host. Host match is the CSRF boundary.
    const req = new NextRequest('https://panel.example.com/api/users', {
      method: 'POST',
      headers: { Origin: 'http://panel.example.com' },
    });
    assert.strictEqual(isValidOrigin(req), true);
  });

  it('allows same-host when request carries explicit default port', () => {
    // A TLS-terminating reverse proxy may forward `Host: panel.example.com:443`;
    // the browser's Origin omits the default port. Both must normalize to the
    // same host so the legitimate mutating request is not falsely rejected.
    const req = new NextRequest('http://panel.example.com:443/api/users', {
      method: 'POST',
      headers: { Origin: 'https://panel.example.com' },
    });
    assert.strictEqual(isValidOrigin(req), true);
  });

  it('allows same-host when a proxy strips a non-default request port', () => {
    const req = new NextRequest('https://panel.example.com/api/users', {
      method: 'POST',
      headers: { Origin: 'https://panel.example.com:8443' },
    });
    assert.strictEqual(isValidOrigin(req), true);
  });

  it('rejects malformed Origin header', () => {
    const req = new NextRequest(`${panelUrl}/api/users`, {
      method: 'POST',
      headers: { Origin: 'not-a-valid-origin' },
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

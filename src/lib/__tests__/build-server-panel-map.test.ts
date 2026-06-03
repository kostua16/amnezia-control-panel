import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServerPanelMap } from '../build-server-panel-map';

const makeServer = (
  id: number,
  overrides: { tailnetIP?: string; tailnetHostname?: string; hostname: string },
) => ({ id, ...overrides });

const makePanel = (id: number, panelUrl: string) => ({ id, panelUrl });

describe('buildServerPanelMap', () => {
  it('returns empty map when no servers', () => {
    const result = buildServerPanelMap(
      [],
      [makePanel(1, 'https://panel1.ts.net')],
    );
    assert.deepStrictEqual(result, {});
  });

  it('returns empty map when no panels', () => {
    const result = buildServerPanelMap(
      [makeServer(1, { hostname: 'srv1' })],
      [],
    );
    assert.deepStrictEqual(result, {});
  });

  it('matches server tailnetIP to panel URL hostname', () => {
    const servers = [
      makeServer(1, { hostname: 'srv1', tailnetIP: '100.64.0.1' }),
    ];
    const panels = [makePanel(10, 'https://100.64.0.1:3333')];
    const result = buildServerPanelMap(servers, panels);
    assert.deepStrictEqual(result, { 1: 10 });
  });

  it('matches server tailnetHostname to panel URL hostname', () => {
    const servers = [
      makeServer(1, { hostname: 'srv1', tailnetHostname: 'mynode' }),
    ];
    const panels = [makePanel(10, 'https://mynode:3333')];
    const result = buildServerPanelMap(servers, panels);
    assert.deepStrictEqual(result, { 1: 10 });
  });

  it('falls back to server hostname', () => {
    const servers = [makeServer(1, { hostname: 'srv1.example.com' })];
    const panels = [makePanel(10, 'https://srv1.example.com:3333')];
    const result = buildServerPanelMap(servers, panels);
    assert.deepStrictEqual(result, { 1: 10 });
  });

  it('prefers tailnetIP over hostname', () => {
    const servers = [
      makeServer(1, {
        hostname: 'srv1.example.com',
        tailnetIP: '100.64.0.1',
      }),
    ];
    const panels = [
      makePanel(10, 'https://100.64.0.1:3333'),
      makePanel(20, 'https://srv1.example.com:3333'),
    ];
    const result = buildServerPanelMap(servers, panels);
    assert.equal(
      result[1],
      10,
      'Should match tailnetIP panel, not hostname panel',
    );
  });

  it('omits unmatched servers', () => {
    const servers = [makeServer(1, { hostname: 'unmatched' })];
    const panels = [makePanel(10, 'https://other.ts.net:3333')];
    const result = buildServerPanelMap(servers, panels);
    assert.deepStrictEqual(result, {});
  });

  it('handles multiple servers and panels', () => {
    const servers = [
      makeServer(1, { hostname: 'srv1', tailnetIP: '100.64.0.1' }),
      makeServer(2, { hostname: 'srv2', tailnetIP: '100.64.0.2' }),
    ];
    const panels = [
      makePanel(10, 'https://100.64.0.1:3333'),
      makePanel(20, 'https://100.64.0.2:3333'),
    ];
    const result = buildServerPanelMap(servers, panels);
    assert.deepStrictEqual(result, { 1: 10, 2: 20 });
  });
});

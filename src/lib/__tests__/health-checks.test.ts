import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHealthReport,
  deriveHealthStatus,
  geoipCheckFromStatus,
  websocketCheckFromReady,
} from '../health-checks';
import type { HealthChecks } from '../health-checks';
import type { GeoIPStatus } from '../geoip-manager';

const dbOk = { ok: true, latencyMs: 2 };
const dbDown = { ok: false, error: 'connection refused' };

function geoipStatus(overrides: Partial<GeoIPStatus> = {}): GeoIPStatus {
  return {
    loaded: true,
    stale: false,
    lastRefreshed: '2026-06-14T00:00:00.000Z',
    fileSize: 4_000_000,
    error: null,
    ...overrides,
  };
}

function checks(overrides: Partial<HealthChecks> = {}): HealthChecks {
  return {
    database: dbOk,
    geoip: geoipCheckFromStatus(geoipStatus()),
    websocket: websocketCheckFromReady(true),
    ...overrides,
  };
}

// --- deriveHealthStatus ---

describe('deriveHealthStatus', () => {
  it('reports ok (200) when every subsystem is healthy', () => {
    assert.deepStrictEqual(deriveHealthStatus(checks()), {
      status: 'ok',
      httpStatus: 200,
    });
  });

  it('reports unhealthy (503) when the database is unreachable, regardless of others', () => {
    const result = deriveHealthStatus(checks({ database: dbDown }));
    assert.strictEqual(result.status, 'unhealthy');
    assert.strictEqual(result.httpStatus, 503);
  });

  it('reports degraded (200) when GeoIP is not loaded', () => {
    const result = deriveHealthStatus(
      checks({ geoip: geoipCheckFromStatus(geoipStatus({ loaded: false })) }),
    );
    assert.strictEqual(result.status, 'degraded');
    assert.strictEqual(result.httpStatus, 200);
  });

  it('reports degraded (200) when GeoIP data is stale', () => {
    const result = deriveHealthStatus(
      checks({ geoip: geoipCheckFromStatus(geoipStatus({ stale: true })) }),
    );
    assert.strictEqual(result.status, 'degraded');
    assert.strictEqual(result.httpStatus, 200);
  });

  it('reports degraded (200) when WebSocket is not ready', () => {
    const result = deriveHealthStatus(
      checks({ websocket: websocketCheckFromReady(false) }),
    );
    assert.strictEqual(result.status, 'degraded');
    assert.strictEqual(result.httpStatus, 200);
  });

  it('treats database failure as unhealthy even when WS is also down', () => {
    const result = deriveHealthStatus(
      checks({ database: dbDown, websocket: websocketCheckFromReady(false) }),
    );
    assert.strictEqual(result.status, 'unhealthy');
    assert.strictEqual(result.httpStatus, 503);
  });
});

// --- geoipCheckFromStatus ---

describe('geoipCheckFromStatus', () => {
  it('is ok when loaded and fresh', () => {
    assert.deepStrictEqual(geoipCheckFromStatus(geoipStatus()), {
      ok: true,
      loaded: true,
      stale: false,
    });
  });

  it('is not ok when loaded but stale', () => {
    const c = geoipCheckFromStatus(geoipStatus({ stale: true }));
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.loaded, true);
    assert.strictEqual(c.stale, true);
  });

  it('is not ok when not loaded', () => {
    const c = geoipCheckFromStatus(geoipStatus({ loaded: false }));
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.loaded, false);
  });
});

// --- websocketCheckFromReady ---

describe('websocketCheckFromReady', () => {
  it('reflects readiness true', () => {
    assert.deepStrictEqual(websocketCheckFromReady(true), {
      ok: true,
      initialized: true,
    });
  });

  it('reflects readiness false', () => {
    assert.deepStrictEqual(websocketCheckFromReady(false), {
      ok: false,
      initialized: false,
    });
  });
});

// --- buildHealthReport ---

describe('buildHealthReport', () => {
  it('echoes checks and derives status', () => {
    const c = checks();
    const report = buildHealthReport(c);
    assert.strictEqual(report.status, 'ok');
    assert.strictEqual(report.checks, c);
    // timestamp must be a valid ISO string.
    assert.strictEqual(typeof report.timestamp, 'string');
    assert.ok(!Number.isNaN(Date.parse(report.timestamp)));
  });

  it('reports unhealthy status in the body when the database is down', () => {
    const report = buildHealthReport(checks({ database: dbDown }));
    assert.strictEqual(report.status, 'unhealthy');
  });
});

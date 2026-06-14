import type { DatabaseHealthResult } from '@/lib/prisma';
import type { GeoIPStatus } from '@/lib/geoip-manager';

/** Database connectivity probe result (see `checkDatabaseConnection`). */
export type DatabaseCheck = DatabaseHealthResult;

/** GeoIP subsystem probe result. */
export interface GeoIPCheck {
  ok: boolean;
  loaded: boolean;
  stale: boolean;
}

/** WebSocket subsystem probe result. */
export interface WebSocketCheck {
  ok: boolean;
  initialized: boolean;
}

/** Per-subsystem probe results fed into the health aggregator. */
export interface HealthChecks {
  database: DatabaseCheck;
  geoip: GeoIPCheck;
  websocket: WebSocketCheck;
}

export type HealthStatus = 'ok' | 'degraded' | 'unhealthy';

/**
 * Derive the overall panel health from subsystem checks.
 *
 * - `unhealthy` (HTTP 503): the database is unreachable — the panel cannot
 *   function, so load balancers and Docker HEALTHCHECK should route away.
 * - `degraded` (HTTP 200): a non-critical subsystem (GeoIP or WebSocket) is
 *   down or stale. The panel still works with limitations.
 * - `ok` (HTTP 200): every subsystem passed.
 */
export function deriveHealthStatus(checks: HealthChecks): {
  status: HealthStatus;
  httpStatus: 200 | 503;
} {
  if (!checks.database.ok) {
    return { status: 'unhealthy', httpStatus: 503 };
  }
  if (!checks.geoip.ok || !checks.websocket.ok) {
    return { status: 'degraded', httpStatus: 200 };
  }
  return { status: 'ok', httpStatus: 200 };
}

/** Sanitize a raw DB probe result for unauthenticated callers. On success the
 *  full result (ok, latencyMs) passes through; on failure any raw error text
 *  — which may contain connection strings, file paths, or adapter details — is
 *  replaced with a static sentinel so nothing sensitive leaves the process. */
export function sanitizeDatabaseCheck(
  raw: DatabaseHealthResult,
): DatabaseCheck {
  return raw.ok ? raw : { ok: false, error: 'database unreachable' };
}

/** Map a GeoIP status snapshot to a health check result. */
export function geoipCheckFromStatus(status: GeoIPStatus): GeoIPCheck {
  return {
    ok: status.loaded && !status.stale,
    loaded: status.loaded,
    stale: status.stale,
  };
}

/** Map WebSocket readiness to a health check result. */
export function websocketCheckFromReady(ready: boolean): WebSocketCheck {
  return { ok: ready, initialized: ready };
}

/** Structured health response body returned by `/api/health`. */
export interface HealthReport {
  status: HealthStatus;
  checks: HealthChecks;
  timestamp: string;
}

/** Build the full health report body from subsystem probes. */
export function buildHealthReport(checks: HealthChecks): HealthReport {
  const { status } = deriveHealthStatus(checks);
  return {
    status,
    checks,
    timestamp: new Date().toISOString(),
  };
}

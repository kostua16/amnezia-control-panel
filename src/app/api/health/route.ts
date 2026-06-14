import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { checkDatabaseConnection } from '@/lib/prisma';
import type { DatabaseHealthResult } from '@/lib/prisma';
import { getGeoIPStatus } from '@/lib/geoip-manager';
import { isWebSocketReady } from '@/lib/websocket';
import {
  buildHealthReport,
  deriveHealthStatus,
  geoipCheckFromStatus,
  websocketCheckFromReady,
} from '@/lib/health-checks';

export const GET = apiHandler(async () => {
  // Database is the only async probe (bounded by an internal timeout); GeoIP
  // status and WebSocket readiness are in-memory reads.
  const rawDatabase = await checkDatabaseConnection();

  // Sanitize: never expose raw Prisma error details (which may contain
  // connection strings, file paths, or adapter text) to unauthenticated callers.
  const database: DatabaseHealthResult = rawDatabase.ok
    ? rawDatabase
    : { ok: false, error: 'database unreachable' };

  const geoipStatus = getGeoIPStatus();

  const checks = {
    database,
    geoip: geoipCheckFromStatus(geoipStatus),
    websocket: websocketCheckFromReady(isWebSocketReady()),
  };

  const { httpStatus } = deriveHealthStatus(checks);
  return NextResponse.json(buildHealthReport(checks), { status: httpStatus });
}, 'api/health');

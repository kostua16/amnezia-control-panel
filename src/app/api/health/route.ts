import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api-handler';
import { checkDatabaseConnection } from '@/lib/prisma';
import { getGeoIPStatus } from '@/lib/geoip-manager';
import { isWebSocketReady } from '@/lib/websocket';
import {
  buildHealthReport,
  deriveHealthStatus,
  geoipCheckFromStatus,
  sanitizeDatabaseCheck,
  websocketCheckFromReady,
} from '@/lib/health-checks';

export const GET = apiHandler(async () => {
  // Database is the only async probe (bounded by an internal timeout); GeoIP
  // status and WebSocket readiness are in-memory reads.
  const rawDatabase = await checkDatabaseConnection();
  const database = sanitizeDatabaseCheck(rawDatabase);

  const geoipStatus = getGeoIPStatus();

  const checks = {
    database,
    geoip: geoipCheckFromStatus(geoipStatus),
    websocket: websocketCheckFromReady(isWebSocketReady()),
  };

  const { httpStatus } = deriveHealthStatus(checks);
  return NextResponse.json(buildHealthReport(checks), { status: httpStatus });
}, 'api/health');

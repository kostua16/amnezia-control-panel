import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { error } from '@/lib/api-response';
import { RETENTION_DAYS } from '@/lib/traffic-log-cleanup';

/**
 * Hard cap on the number of time-bucket rows a single query may return.
 * Prevents unbounded memory growth when the retention window is large or
 * the chosen period (hourly) produces many buckets.
 */
const QUERY_RESULT_LIMIT = 10000;

const trafficStatsSchema = z.object({
  userId: z.coerce.number().int().min(1).optional(),
  period: z
    .enum(['hourly', 'daily', 'weekly', 'monthly'])
    .optional()
    .default('daily'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

type Period = 'hourly' | 'daily' | 'weekly' | 'monthly';

const TRUNC_EXPRS: Record<Period, string> = {
  hourly: "strftime('%Y-%m-%d %H:00', timestamp)",
  daily: "strftime('%Y-%m-%d', timestamp)",
  weekly: "strftime('%Y-W%W', timestamp)",
  monthly: "strftime('%Y-%m', timestamp)",
};

/**
 * Clamp the requested date range to the retention window.
 * Returns { clampedFrom, clampedTo } or an error response if the
 * requested range exceeds the maximum allowed span.
 */
function clampDateRange(
  startDate: Date | undefined,
  endDate: Date | undefined,
): { clampedFrom: Date; clampedTo: Date } | NextResponse {
  const now = new Date();
  const maxFrom = new Date(now);
  maxFrom.setDate(maxFrom.getDate() - RETENTION_DAYS);

  // If caller passed dates, validate the range before clamping.
  if (startDate && endDate) {
    const rangeMs = endDate.getTime() - startDate.getTime();
    const maxRangeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (rangeMs > maxRangeMs) {
      return error(
        `Requested date range exceeds the ${RETENTION_DAYS}-day maximum`,
        422,
      );
    }
  }

  const clampedFrom = startDate
    ? new Date(Math.max(startDate.getTime(), maxFrom.getTime()))
    : maxFrom;
  const clampedTo = endDate
    ? new Date(Math.min(endDate.getTime(), now.getTime()))
    : now;

  return { clampedFrom, clampedTo };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());
    const parsed = trafficStatsSchema.safeParse(params);

    if (!parsed.success) {
      return error('Invalid query parameters', 422);
    }

    const {
      userId,
      period,
      startDate: startDateStr,
      endDate: endDateStr,
    } = parsed.data;

    // Parse and clamp the date range to the retention window.
    const start = startDateStr ? new Date(startDateStr) : undefined;
    const end = endDateStr ? new Date(endDateStr) : undefined;
    // Reject invalid date strings with 422 rather than letting toISOString()
    // throw and surface as a 500.
    if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime()))) {
      return error('Invalid date format', 422);
    }
    const clamped = clampDateRange(start, end);
    if (clamped instanceof NextResponse) return clamped;
    const { clampedFrom, clampedTo } = clamped;

    // Build parameterized query using Prisma tagged template.
    // truncExpr comes from a fixed map (not user input), so Prisma.raw is safe.
    // User values are bound as parameters via Prisma.sql interpolation.
    const truncExpr = TRUNC_EXPRS[period];
    const conditions: Prisma.Sql[] = [];

    if (userId) {
      conditions.push(Prisma.sql`userId = ${userId}`);
    }
    conditions.push(Prisma.sql`timestamp >= ${clampedFrom.toISOString()}`);
    conditions.push(Prisma.sql`timestamp <= ${clampedTo.toISOString()}`);

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const bucketsRaw: Array<{
      bucket: string;
      bytesIn: bigint;
      bytesOut: bigint;
      userCount: bigint;
    }> = await prisma.$queryRaw`
      SELECT ${Prisma.raw(truncExpr)} as bucket, SUM(bytesIn) as "bytesIn", SUM(bytesOut) as "bytesOut", COUNT(DISTINCT userId) as "userCount"
      FROM traffic_logs ${whereClause}
      GROUP BY bucket
      ORDER BY bucket ASC
      LIMIT ${QUERY_RESULT_LIMIT}
    `;

    const buckets = bucketsRaw.map((row) => ({
      timestamp: row.bucket,
      bytesIn: Number(row.bytesIn),
      bytesOut: Number(row.bytesOut),
      userCount: Number(row.userCount),
    }));

    const totalIn = buckets.reduce((sum, b) => sum + b.bytesIn, 0);
    const totalOut = buckets.reduce((sum, b) => sum + b.bytesOut, 0);

    const truncated = bucketsRaw.length >= QUERY_RESULT_LIMIT;

    return NextResponse.json(
      { success: true, data: { buckets, totalIn, totalOut } },
      {
        status: 200,
        headers: truncated ? { 'X-Result-Truncated': 'true' } : {},
      },
    );
  } catch (err) {
    console.error('[api/stats/traffic] Error:', err);
    return error('Failed to fetch traffic statistics');
  }
}

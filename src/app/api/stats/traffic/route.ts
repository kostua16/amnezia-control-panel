import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { success, error } from '@/lib/api-response';

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

/**
 * SQLite-compatible date truncation via strftime.
 * Returns a SQL expression string for grouping by period.
 */
function getTruncExpr(period: Period): string {
  switch (period) {
    case 'hourly':
      return "strftime('%Y-%m-%d %H:00', timestamp)";
    case 'daily':
      return "strftime('%Y-%m-%d', timestamp)";
    case 'weekly':
      return "strftime('%Y-W%W', timestamp)";
    case 'monthly':
      return "strftime('%Y-%m', timestamp)";
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());
    const parsed = trafficStatsSchema.safeParse(params);

    if (!parsed.success) {
      return error('Invalid query parameters', 422);
    }

    const { userId, period, startDate, endDate } = parsed.data;

    // Build WHERE clause
    const whereConditions: string[] = [];
    const whereParams: Record<string, unknown> = {};

    if (userId) {
      whereConditions.push('userId = $userId');
      whereParams.userId = userId;
    }

    if (startDate) {
      const sd = new Date(startDate);
      if (!isNaN(sd.getTime())) {
        whereConditions.push('timestamp >= $startDate');
        whereParams.startDate = sd.toISOString();
      }
    }

    if (endDate) {
      const ed = new Date(endDate);
      if (!isNaN(ed.getTime())) {
        whereConditions.push('timestamp <= $endDate');
        whereParams.endDate = ed.toISOString();
      }
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';

    const truncExpr = getTruncExpr(period);

    // Aggregate traffic by time bucket
    const bucketsRaw: Array<{
      bucket: string;
      bytesIn: bigint;
      bytesOut: bigint;
      userCount: bigint;
    }> = await prisma.$queryRawUnsafe(
      `
      SELECT
        ${truncExpr} as bucket,
        SUM(bytesIn) as "bytesIn",
        SUM(bytesOut) as "bytesOut",
        COUNT(DISTINCT userId) as "userCount"
      FROM traffic_logs
      ${whereClause}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    );

    const buckets = bucketsRaw.map((row) => ({
      timestamp: row.bucket,
      bytesIn: Number(row.bytesIn),
      bytesOut: Number(row.bytesOut),
      userCount: Number(row.userCount),
    }));

    const totalIn = buckets.reduce((sum, b) => sum + b.bytesIn, 0);
    const totalOut = buckets.reduce((sum, b) => sum + b.bytesOut, 0);

    return success({
      buckets,
      totalIn,
      totalOut,
    });
  } catch (err) {
    console.error('[api/stats/traffic] Error:', err);
    return error('Failed to fetch traffic statistics');
  }
}

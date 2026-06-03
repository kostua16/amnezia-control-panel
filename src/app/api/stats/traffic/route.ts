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

const TRUNC_EXPRS: Record<Period, string> = {
  hourly: "strftime('%Y-%m-%d %H:00', timestamp)",
  daily: "strftime('%Y-%m-%d', timestamp)",
  weekly: "strftime('%Y-W%W', timestamp)",
  monthly: "strftime('%Y-%m', timestamp)",
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());
    const parsed = trafficStatsSchema.safeParse(params);

    if (!parsed.success) {
      return error('Invalid query parameters', 422);
    }

    const { userId, period, startDate, endDate } = parsed.data;

    // Build parameterized query — truncExpr is safe (from fixed map),
    // user values are bound via Prisma.sql tagged template.
    const truncExpr = TRUNC_EXPRS[period];
    const conditions: string[] = [];
    const p: unknown[] = [];

    if (userId) {
      conditions.push(`userId = ?`);
      p.push(userId);
    }
    if (startDate) {
      const sd = new Date(startDate);
      if (!isNaN(sd.getTime())) {
        conditions.push(`timestamp >= ?`);
        p.push(sd.toISOString());
      }
    }
    if (endDate) {
      const ed = new Date(endDate);
      if (!isNaN(ed.getTime())) {
        conditions.push(`timestamp <= ?`);
        p.push(ed.toISOString());
      }
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Prisma.sql only allows ? placeholders via tagged template interpolation.
    // Build the final query with Prisma.join for the parameter list.
    // Since truncExpr and whereClause are server-controlled (not user input),
    // and all user values are bound as parameters, this is safe.
    const bucketsRaw: Array<{
      bucket: string;
      bytesIn: bigint;
      bytesOut: bigint;
      userCount: bigint;
    }> = await prisma.$queryRawUnsafe(
      `SELECT ${truncExpr} as bucket, SUM(bytesIn) as "bytesIn", SUM(bytesOut) as "bytesOut", COUNT(DISTINCT userId) as "userCount" FROM traffic_logs ${whereClause} GROUP BY bucket ORDER BY bucket ASC`,
      ...p,
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

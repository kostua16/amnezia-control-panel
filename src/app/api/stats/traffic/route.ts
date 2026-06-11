import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
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

    // Build parameterized query using Prisma tagged template.
    // truncExpr comes from a fixed map (not user input), so Prisma.raw is safe.
    // User values are bound as parameters via Prisma.sql interpolation.
    const truncExpr = TRUNC_EXPRS[period];
    const conditions: Prisma.Sql[] = [];

    if (userId) {
      conditions.push(Prisma.sql`userId = ${userId}`);
    }
    if (startDate) {
      const sd = new Date(startDate);
      if (!isNaN(sd.getTime())) {
        conditions.push(Prisma.sql`timestamp >= ${sd.toISOString()}`);
      }
    }
    if (endDate) {
      const ed = new Date(endDate);
      if (!isNaN(ed.getTime())) {
        conditions.push(Prisma.sql`timestamp <= ${ed.toISOString()}`);
      }
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    const bucketsRaw: Array<{
      bucket: string;
      bytesIn: bigint;
      bytesOut: bigint;
      userCount: bigint;
    }> = await prisma.$queryRaw`
      SELECT ${Prisma.raw(truncExpr)} as bucket, SUM(bytesIn) as "bytesIn", SUM(bytesOut) as "bytesOut", COUNT(DISTINCT userId) as "userCount" FROM traffic_logs ${whereClause} GROUP BY bucket ORDER BY bucket ASC
    `;

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

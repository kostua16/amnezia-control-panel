import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { success, error } from '@/lib/api-response';

const topUsersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  period: z
    .enum(['hourly', 'daily', 'weekly', 'monthly'])
    .optional()
    .default('daily'),
});

function getDateFilter(period: string): Date {
  const now = new Date();
  switch (period) {
    case 'hourly':
      return new Date(now.getTime() - 60 * 60 * 1000);
    case 'daily':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case 'weekly':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'monthly':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());
    const parsed = topUsersSchema.safeParse(params);

    if (!parsed.success) {
      return error('Invalid query parameters', 422);
    }

    const { limit, period } = parsed.data;
    const cutoff = getDateFilter(period);

    const topUsers = await prisma.$queryRawUnsafe<
      Array<{
        userId: number;
        username: string;
        totalBytesIn: bigint;
        totalBytesOut: bigint;
        totalBytes: bigint;
      }>
    >(
      `
      SELECT
        tl.userId as "userId",
        u.username as "username",
        SUM(tl.bytesIn) as "totalBytesIn",
        SUM(tl.bytesOut) as "totalBytesOut",
        SUM(tl.bytesIn) + SUM(tl.bytesOut) as "totalBytes"
      FROM traffic_logs tl
      JOIN users u ON u.id = tl.userId
      WHERE tl.timestamp >= ?
      GROUP BY tl.userId, u.username
      ORDER BY "totalBytes" DESC
      LIMIT ?
    `,
      cutoff.toISOString(),
      limit,
    );

    const data = topUsers.map((row) => ({
      userId: row.userId,
      username: row.username,
      totalBytesIn: Number(row.totalBytesIn),
      totalBytesOut: Number(row.totalBytesOut),
      totalBytes: Number(row.totalBytes),
    }));

    return success(data);
  } catch (err) {
    console.error('[api/stats/traffic/users] Error:', err);
    return error('Failed to fetch top users by traffic');
  }
}

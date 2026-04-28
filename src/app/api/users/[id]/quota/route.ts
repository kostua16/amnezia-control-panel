import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const updateQuotaSchema = z.object({
  quotaBytes: z.number().int().min(0).optional(),
  period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

function calculateResetAt(period: 'DAILY' | 'WEEKLY' | 'MONTHLY'): Date {
  const now = new Date();
  const reset = new Date(now);

  switch (period) {
    case 'DAILY':
      reset.setDate(reset.getDate() + 1);
      reset.setHours(0, 0, 0, 0);
      break;
    case 'WEEKLY':
      reset.setDate(reset.getDate() + ((7 - reset.getDay() + 1) % 7 || 7));
      reset.setHours(0, 0, 0, 0);
      break;
    case 'MONTHLY':
      reset.setMonth(reset.getMonth() + 1, 1);
      reset.setHours(0, 0, 0, 0);
      break;
  }

  return reset;
}

// ─── GET: Fetch user quota ───────────────────────────────

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid user ID' },
        { status: 422 },
      );
    }

    // Check user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 },
      );
    }

    const quota = await prisma.userQuota.findUnique({
      where: { userId },
    });

    return NextResponse.json({
      success: true,
      data: quota
        ? {
            id: quota.id,
            userId: quota.userId,
            quotaBytes: quota.quotaBytes,
            period: quota.period,
            resetAt: quota.resetAt?.toISOString() ?? null,
          }
        : null,
    });
  } catch (err) {
    console.error('[api/users/[id]/quota GET] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch quota' },
      { status: 500 },
    );
  }
}

// ─── PUT: Update user quota ──────────────────────────────

export async function PUT(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid user ID' },
        { status: 422 },
      );
    }

    const body = await request.json();
    const parsed = updateQuotaSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    // Check user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 },
      );
    }

    const { quotaBytes, period } = parsed.data;

    // If quotaBytes is 0, interpret as unlimited
    const resolvedQuotaBytes = quotaBytes ?? 0;
    const resolvedPeriod = period ?? 'MONTHLY';
    const resetAt = calculateResetAt(resolvedPeriod);

    // Upsert quota record
    const quota = await prisma.userQuota.upsert({
      where: { userId },
      create: {
        userId,
        quotaBytes: resolvedQuotaBytes,
        period: resolvedPeriod,
        resetAt,
      },
      update: {
        quotaBytes: resolvedQuotaBytes,
        period: resolvedPeriod,
        resetAt,
      },
    });

    // Also update the denormalized field on User
    await prisma.user.update({
      where: { id: userId },
      data: { trafficQuotaBytes: resolvedQuotaBytes },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: quota.id,
        userId: quota.userId,
        quotaBytes: quota.quotaBytes,
        period: quota.period,
        resetAt: quota.resetAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    console.error('[api/users/[id]/quota PUT] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update quota' },
      { status: 500 },
    );
  }
}

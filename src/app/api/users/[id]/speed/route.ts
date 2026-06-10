import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit-log';

const updateSpeedSchema = z.object({
  speedLimitKbps: z.number().int().min(0),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── GET: Fetch user speed limit ─────────────────────────

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid user ID' },
        { status: 422 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, speedLimitKbps: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        userId: user.id,
        speedLimitKbps: user.speedLimitKbps,
      },
    });
  } catch (err) {
    console.error('[api/users/[id]/speed GET] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch speed limit' },
      { status: 500 },
    );
  }
}

// ─── PUT: Update user speed limit ────────────────────────

export async function PUT(request: NextRequest, context: RouteContext) {
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
    const parsed = updateSpeedSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
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

    const { speedLimitKbps } = parsed.data;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { speedLimitKbps },
      select: { id: true, speedLimitKbps: true },
    });

    await writeAuditLog({
      action: 'user.speed.update',
      resource: 'user',
      resourceId: userId,
      metadata: { username: user.username, speedLimitKbps },
    });

    return NextResponse.json({
      success: true,
      data: {
        userId: updated.id,
        speedLimitKbps: updated.speedLimitKbps,
      },
    });
  } catch (err) {
    console.error('[api/users/[id]/speed PUT] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update speed limit' },
      { status: 500 },
    );
  }
}

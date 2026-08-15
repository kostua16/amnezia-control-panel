import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit-log';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
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
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 },
      );
    }

    await prisma.trafficLog.deleteMany({
      where: { userId },
    });

    await writeAuditLog({
      action: 'reset_traffic',
      resource: 'user',
      resourceId: user.id.toString(),
      metadata: JSON.stringify({ username: user.username }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/users/[id]/traffic DELETE] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

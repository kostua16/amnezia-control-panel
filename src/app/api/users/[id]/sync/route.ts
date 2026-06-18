import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiHandler } from '@/lib/api-handler';
import { error } from '@/lib/api-response';
import { syncUser } from '@/lib/user-sync';

export const POST = apiHandler(
  async (_request: NextRequest, { params }: { params: { id: string } }) => {
    const userId = Number.parseInt(params.id, 10);

    if (Number.isNaN(userId)) {
      return error('Invalid user ID', 422);
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return error('User not found', 404);
    }

    // Trigger sync
    const report = await syncUser(userId);

    return NextResponse.json({
      success: true,
      data: {
        checked: report.checked,
        fixed: report.fixed,
        errors: report.errors,
        details: report.details,
      },
    });
  },
  'api/users/[id]/sync',
);

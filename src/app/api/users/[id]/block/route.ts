import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit-log';
import { blockAwgUser, blockThreeXuiUser } from '@/lib/vpn-services';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid user ID' },
        { status: 422 },
      );
    }

    // Fetch user with active protocols
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        protocols: { where: { isActive: true }, select: { serviceType: true } },
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 },
      );
    }

    if (user.isBlocked) {
      return NextResponse.json(
        { success: false, error: 'User is already blocked' },
        { status: 409 },
      );
    }

    // Block in VPN services (best-effort)
    const vpnResults: Array<{
      serviceType: string;
      success: boolean;
      message: string;
    }> = [];

    for (const protocol of user.protocols) {
      let result;

      if (protocol.serviceType === 'AWG') {
        result = await blockAwgUser(user.username);
      } else if (protocol.serviceType === 'THREE_XUI') {
        result = await blockThreeXuiUser(user.username);
      } else {
        continue;
      }

      if (!result.success) {
        console.warn(
          `[api/users/[id]/block] VPN block failed for ${user.username}/${protocol.serviceType}: ${result.message}`,
        );
      }

      vpnResults.push({
        serviceType: protocol.serviceType,
        success: result.success,
        message: result.message,
      });
    }

    // Update DB
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { isBlocked: true },
    });

    await writeAuditLog({
      action: 'user.block',
      resource: 'user',
      resourceId: userId,
      metadata: { username: user.username, vpnResults },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updatedUser.id,
        username: updatedUser.username,
        isBlocked: updatedUser.isBlocked,
      },
      vpnServiceStatus: vpnResults,
    });
  } catch (err) {
    console.error('[api/users/[id]/block] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to block user' },
      { status: 500 },
    );
  }
}

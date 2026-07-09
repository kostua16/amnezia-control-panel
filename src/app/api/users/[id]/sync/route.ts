import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { apiHandler } from '@/lib/api-handler';
import { error } from '@/lib/api-response';
import { syncUser } from '@/lib/user-sync';
import { createAwgUser, createThreeXuiUser } from '@/lib/vpn-services';
import type { VpnServiceResult } from '@/lib/vpn-services';

function hasProvisioningConfig(config: Prisma.JsonValue): boolean {
  return (
    !!config &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    Object.keys(config).length > 0
  );
}

export const POST = apiHandler(
  async (_request: NextRequest, { params }: { params: { id: string } }) => {
    const userId = Number.parseInt(params.id, 10);

    if (Number.isNaN(userId)) {
      return error('Invalid user ID', 422);
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { protocols: true },
    });

    if (!user) {
      return error('User not found', 404);
    }

    let provisioningFixed = 0;
    const provisioningErrors: string[] = [];
    const provisioningDetails: Array<{
      userId: number;
      username: string;
      action: string;
      description: string;
    }> = [];

    for (const protocol of user.protocols) {
      if (protocol.isActive || hasProvisioningConfig(protocol.config)) {
        continue;
      }

      let result: VpnServiceResult & { config?: Record<string, unknown> };
      if (protocol.serviceType === 'AWG') {
        result = await createAwgUser(user.username);
      } else if (protocol.serviceType === 'THREE_XUI') {
        result = await createThreeXuiUser(user.username);
      } else {
        continue;
      }

      if (result.success && result.config) {
        await prisma.userProtocol.update({
          where: { id: protocol.id },
          data: {
            isActive: true,
            config: result.config as unknown as Prisma.InputJsonValue,
          },
        });
        provisioningFixed++;
        provisioningDetails.push({
          userId: user.id,
          username: user.username,
          action: 'retry-provisioning',
          description: `Provisioned ${protocol.serviceType} for ${user.username}`,
        });
      } else {
        provisioningErrors.push(
          `Failed to provision ${protocol.serviceType} for ${user.username}: ${result.message}`,
        );
      }
    }

    if (!user.isActive && provisioningFixed > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: true },
      });
    }

    const report = await syncUser(userId);

    return NextResponse.json({
      success: true,
      data: {
        checked: report.checked,
        fixed: report.fixed + provisioningFixed,
        errors: [...provisioningErrors, ...report.errors],
        details: [...provisioningDetails, ...report.details],
      },
    });
  },
  'api/users/[id]/sync',
);

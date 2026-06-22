import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashValue } from '@/lib/password';
import { writeAuditLog } from '@/lib/audit-log';
import {
  createAwgUser,
  createThreeXuiUser,
  deleteAwgUser,
  deleteThreeXuiUser,
} from '@/lib/vpn-services';
import type { VpnServiceResult } from '@/lib/vpn-services';

const serviceTypeEnum = z.enum(['AWG', 'THREE_XUI']);

const updateUserSchema = z.object({
  displayName: z.string().nullable().optional(),
  trafficQuotaBytes: z.number().int().min(0).optional(),
  speedLimitKbps: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  newPassword: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .optional(),
  services: z.array(serviceTypeEnum).optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── GET: Fetch single user ──────────────────────────────

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
      include: {
        protocols: {
          where: { isActive: true },
          select: { serviceType: true },
        },
      },
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
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isActive: user.isActive,
        isBlocked: user.isBlocked,
        trafficQuotaBytes: user.trafficQuotaBytes,
        speedLimitKbps: user.speedLimitKbps,
        assignedServices: user.protocols.map((p) => p.serviceType),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('[api/users/[id] GET] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch user' },
      { status: 500 },
    );
  }
}

// ─── PUT: Update user ────────────────────────────────────

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
    const parsed = updateUserSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const {
      displayName,
      trafficQuotaBytes,
      speedLimitKbps,
      isActive,
      newPassword,
      services,
    } = parsed.data;

    // Check user exists
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        protocols: { where: { isActive: true } },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 },
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (trafficQuotaBytes !== undefined)
      updateData.trafficQuotaBytes = trafficQuotaBytes;
    if (speedLimitKbps !== undefined)
      updateData.speedLimitKbps = speedLimitKbps;
    if (isActive !== undefined) updateData.isActive = isActive;

    // Hash new password if provided
    if (newPassword) {
      updateData.passwordHash = await hashValue(newPassword);
    }

    // Update user in DB
    await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        protocols: true,
      },
    });

    // Update services if provided
    const vpnResults: Array<{
      serviceType: string;
      action: string;
      success: boolean;
      message: string;
    }> = [];

    if (services) {
      const currentServices = existing.protocols
        .filter((p) => p.isActive)
        .map((p) => p.serviceType);

      const toAdd = services.filter((s) => !currentServices.includes(s));
      const toRemove = currentServices.filter((s) => !services.includes(s));

      // Remove services that were unchecked
      for (const serviceType of toRemove) {
        // Delete from VPN service first
        let vpnResult: VpnServiceResult;
        if (serviceType === 'AWG') {
          vpnResult = await deleteAwgUser(existing.username);
        } else if (serviceType === 'THREE_XUI') {
          vpnResult = await deleteThreeXuiUser(existing.username);
        } else {
          continue;
        }

        vpnResults.push({
          serviceType,
          action: 'remove',
          success: vpnResult.success,
          message: vpnResult.message,
        });

        // Deactivate protocol in DB
        await prisma.userProtocol.updateMany({
          where: { userId, serviceType, isActive: true },
          data: { isActive: false },
        });
      }

      // Add new services
      for (const serviceType of toAdd) {
        let vpnResult: VpnServiceResult & { config?: Record<string, unknown> };
        if (serviceType === 'AWG') {
          vpnResult = await createAwgUser(existing.username);
        } else if (serviceType === 'THREE_XUI') {
          vpnResult = await createThreeXuiUser(existing.username);
        } else {
          continue;
        }

        vpnResults.push({
          serviceType,
          action: 'add',
          success: vpnResult.success,
          message: vpnResult.message,
        });

        // Create or reactivate protocol in DB
        const existingProtocol = await prisma.userProtocol.findFirst({
          where: { userId, serviceType },
        });

        if (existingProtocol) {
          await prisma.userProtocol.update({
            where: { id: existingProtocol.id },
            data: {
              isActive: true,
              protocol: serviceType === 'AWG' ? 'wireguard' : 'xray',
              config: vpnResult.config ? (vpnResult.config as never) : {},
            },
          });
        } else {
          await prisma.userProtocol.create({
            data: {
              userId,
              serviceType,
              protocol: serviceType === 'AWG' ? 'wireguard' : 'xray',
              config: vpnResult.config ? (vpnResult.config as never) : {},
            },
          });
        }
      }
    }

    // Fetch final state with active protocols
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        protocols: { where: { isActive: true }, select: { serviceType: true } },
      },
    });

    await writeAuditLog({
      action: 'user.update',
      resource: 'user',
      resourceId: userId,
      metadata: {
        username: existing.username,
        changedFields: Object.keys(updateData).filter(
          (field) => field !== 'passwordHash',
        ),
        passwordChanged: Boolean(newPassword),
        servicesChanged: services !== undefined,
        vpnResults,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updatedUser!.id,
        username: updatedUser!.username,
        displayName: updatedUser!.displayName,
        isActive: updatedUser!.isActive,
        isBlocked: updatedUser!.isBlocked,
        trafficQuotaBytes: updatedUser!.trafficQuotaBytes,
        speedLimitKbps: updatedUser!.speedLimitKbps,
        assignedServices: updatedUser!.protocols.map((p) => p.serviceType),
        createdAt: updatedUser!.createdAt.toISOString(),
        updatedAt: updatedUser!.updatedAt.toISOString(),
      },
      vpnServiceStatus: vpnResults.length > 0 ? vpnResults : undefined,
    });
  } catch (err) {
    console.error('[api/users/[id] PUT] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update user' },
      { status: 500 },
    );
  }
}

// ─── DELETE: Remove user ─────────────────────────────────

export async function DELETE(_request: NextRequest, context: RouteContext) {
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

    // Delete from VPN services (best-effort — log failures but do not block)
    const vpnResults: Array<{
      serviceType: string;
      success: boolean;
      message: string;
    }> = [];

    for (const protocol of user.protocols) {
      let result: VpnServiceResult;

      if (protocol.serviceType === 'AWG') {
        result = await deleteAwgUser(user.username);
      } else if (protocol.serviceType === 'THREE_XUI') {
        result = await deleteThreeXuiUser(user.username);
      } else {
        continue;
      }

      if (!result.success) {
        console.warn(
          `[api/users/[id] DELETE] VPN service deletion failed for ${user.username}/${protocol.serviceType}: ${result.message}`,
        );
      }

      vpnResults.push({
        serviceType: protocol.serviceType,
        success: result.success,
        message: result.message,
      });
    }

    // Delete user from DB (cascade handles UserProtocol, UserQuota, TrafficLog)
    await prisma.user.delete({
      where: { id: userId },
    });

    await writeAuditLog({
      action: 'user.delete',
      resource: 'user',
      resourceId: userId,
      metadata: {
        username: user.username,
        assignedServices: user.protocols.map((p) => p.serviceType),
        vpnResults,
      },
    });

    return NextResponse.json({
      success: true,
      data: { id: userId, username: user.username },
      vpnServiceStatus: vpnResults,
    });
  } catch (err) {
    console.error('[api/users/[id] DELETE] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete user' },
      { status: 500 },
    );
  }
}

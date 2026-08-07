import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody } from '@/lib/parse-body';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { hashValue } from '@/lib/password';
import { writeAuditLog } from '@/lib/audit-log';
import { getAdapter } from '@/lib/vpn-service-adapter';
import type { VpnServiceResult } from '@/lib/vpn-services';
import { apiHandler } from '@/lib/api-handler';
import { error, validationError } from '@/lib/api-response';
import { createAlert } from '@/lib/alert-service';
import { AlertSeverity } from '@/generated/prisma/enums';
import { hasPartialProvisioning } from '@/lib/provisioning-state';

const listUsersSchema = z.object({
  search: z.string().optional().default(''),
  sortBy: z
    .enum(['createdAt', 'username', 'displayName'])
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

const serviceTypeEnum = z.enum(['AWG', 'THREE_XUI']);

const createUserSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(64, 'Username must be at most 64 characters'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  displayName: z.string().optional(),
  trafficQuotaBytes: z.number().int().min(0).optional(),
  speedLimitKbps: z.number().int().min(0).optional(),
  services: z.array(serviceTypeEnum).optional().default(['AWG', 'THREE_XUI']),
});

export const GET = apiHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const params = Object.fromEntries(searchParams.entries());
  const parsed = listUsersSchema.safeParse(params);

  if (!parsed.success) {
    return error('Invalid query parameters', 422);
  }

  const { search, sortBy, sortOrder, page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          { username: { contains: search } },
          { displayName: { contains: search } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        protocols: {
          select: { serviceType: true, isActive: true, config: true },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  const data = users.map((user) => {
    const activeProtocols = user.protocols.filter((p) => p.isActive);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      isActive: user.isActive,
      isBlocked: user.isBlocked,
      trafficQuotaBytes: user.trafficQuotaBytes,
      speedLimitKbps: user.speedLimitKbps,
      assignedServices: activeProtocols.map((p) => p.serviceType),
      hasPartialProvisioning: hasPartialProvisioning(user.protocols),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  });

  return NextResponse.json({
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}, 'api/users');

export const POST = apiHandler(async (request: NextRequest) => {
  const body = JSON.parse(await readBody(request));
  const parsed = createUserSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const {
    username,
    password,
    displayName,
    trafficQuotaBytes,
    speedLimitKbps,
    services,
  } = parsed.data;

  const passwordHash = await hashValue(password);

  // Build the user creation data with Prisma's generated create-input type so
  // schema changes (renamed/required fields) surface as compile errors instead
  // of failing at runtime with a cryptic Prisma error.
  const userData: Prisma.UserCreateInput = {
    username,
    passwordHash,
    displayName: displayName || null,
    trafficQuotaBytes: trafficQuotaBytes ?? 0,
    speedLimitKbps: speedLimitKbps ?? 0,
    protocols: {
      create: services.map((serviceType) => ({
        serviceType,
        protocol: serviceType === 'AWG' ? 'wireguard' : 'xray',
        config: {},
      })),
    },
  };

  // If quota is specified, create a quota record
  if (trafficQuotaBytes && trafficQuotaBytes > 0) {
    userData.quotas = {
      create: {
        quotaBytes: trafficQuotaBytes,
      },
    };
  }

  const user = await prisma.user.create({
    data: userData,
    include: {
      protocols: true,
    },
  });

  // Attempt VPN service creation for each assigned protocol. A protocol whose
  // remote provisioning fails is tracked so the DB record can be reconciled to
  // match reality instead of persisting as a healthy-looking orphan.
  const vpnResults: Array<{
    serviceType: string;
    success: boolean;
    message: string;
  }> = [];
  const failedProtocolIds: number[] = [];

  for (const protocol of user.protocols) {
    let result: VpnServiceResult & { config?: Record<string, unknown> };

    try {
      const adapter = getAdapter(protocol.serviceType);
      result = await adapter.create(username);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'VPN service creation threw an unknown error';
      result = { success: false, message };
    }

    // A protocol counts as provisioned only when the remote service both
    // succeeded and returned the per-peer config to persist. Every downstream
    // decision — DB reconciliation, the response, allVpnSuccess — reads this
    // one value, so the DB record and the API response can never disagree.
    const provisioned = result.success && !!result.config;

    if (provisioned) {
      // Persist VPN-specific config returned by the service.
      await prisma.userProtocol.update({
        where: { id: protocol.id },
        data: { config: result.config as unknown as Prisma.InputJsonValue },
      });
    } else {
      console.warn(
        `[api/users POST] VPN service creation failed for ${username}/${protocol.serviceType}: ${result.message}`,
      );
      failedProtocolIds.push(protocol.id);
    }

    vpnResults.push({
      serviceType: protocol.serviceType,
      success: provisioned,
      message: result.message,
    });
  }

  const allVpnSuccess =
    vpnResults.length > 0 && vpnResults.every((r) => r.success);

  // Compensating transaction for failed provisioning: mark every protocol
  // whose remote service could not be created as inactive. If no service
  // succeeded at all, the user has no working VPN access and is marked inactive
  // too. This keeps user-sync and the UI from treating broken records as live.
  let userIsActive = user.isActive;
  if (failedProtocolIds.length > 0) {
    await prisma.userProtocol.updateMany({
      where: { id: { in: failedProtocolIds } },
      data: { isActive: false },
    });

    // No service was provisioned at all → the user has no working VPN access.
    if (!vpnResults.some((r) => r.success)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });
      userIsActive = false;
    }
  }

  if (!allVpnSuccess) {
    const failedServices = vpnResults
      .filter((r) => !r.success)
      .map((r) => r.serviceType);
    const alert = await createAlert(
      'vpn-provisioning',
      AlertSeverity.WARNING,
      `User "${username}" created but VPN provisioning incomplete: ${failedServices.join(', ')}`,
    );
    console.log(
      `[api/users POST] Created alert ${alert.id} for partial VPN provisioning failure`,
    );
  }

  await writeAuditLog({
    action: 'user.create',
    resource: 'user',
    resourceId: user.id,
    metadata: {
      username: user.username,
      assignedServices: user.protocols.map((p) => p.serviceType),
      trafficQuotaBytes: user.trafficQuotaBytes,
      speedLimitKbps: user.speedLimitKbps,
      vpnResults,
    },
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isActive: userIsActive,
        isBlocked: user.isBlocked,
        trafficQuotaBytes: user.trafficQuotaBytes,
        speedLimitKbps: user.speedLimitKbps,
        assignedServices: user.protocols.map((p) => p.serviceType),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      vpnServiceStatus: vpnResults,
      vpnAllSuccess: allVpnSuccess,
    },
    { status: 201 },
  );
}, 'api/users');

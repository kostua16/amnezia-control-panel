import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createAwgUser, createThreeXuiUser } from '@/lib/vpn-services';
import type { VpnServiceResult } from '@/lib/vpn-services';

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());
    const parsed = listUsersSchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid query parameters' },
        { status: 422 },
      );
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
            where: { isActive: true },
            select: { serviceType: true },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    const data = users.map((user) => ({
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
    }));

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
  } catch (err) {
    console.error('[api/users] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch users' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const {
      username,
      password,
      displayName,
      trafficQuotaBytes,
      speedLimitKbps,
      services,
    } = parsed.data;

    // Hash the password using a simple approach (bcrypt in production)
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);

    // Build the user creation data
    const userData: Record<string, unknown> = {
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
      data: userData as never,
      include: {
        protocols: true,
      },
    });

    // Attempt VPN service creation for each assigned protocol.
    // Failures are logged but do not roll back the DB record.
    const vpnResults: Array<{
      serviceType: string;
      success: boolean;
      message: string;
    }> = [];

    for (const protocol of user.protocols) {
      let result: VpnServiceResult & { config?: Record<string, unknown> };

      if (protocol.serviceType === 'AWG') {
        result = await createAwgUser(username);
      } else if (protocol.serviceType === 'THREE_XUI') {
        result = await createThreeXuiUser(username);
      } else {
        continue;
      }

      if (result.success && result.config) {
        // Persist VPN-specific config returned by the service.
        await prisma.userProtocol.update({
          where: { id: protocol.id },
          data: { config: result.config as never },
        });
      } else {
        console.warn(
          `[api/users POST] VPN service creation failed for ${username}/${protocol.serviceType}: ${result.message}`,
        );
      }

      vpnResults.push({
        serviceType: protocol.serviceType,
        success: result.success,
        message: result.message,
      });
    }

    const allVpnSuccess =
      vpnResults.length > 0 && vpnResults.every((r) => r.success);

    return NextResponse.json(
      {
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
        vpnServiceStatus: vpnResults,
        vpnAllSuccess: allVpnSuccess,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/users POST] Error:', err);

    // Handle unique constraint violation (duplicate username)
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { success: false, error: 'Username already exists' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to create user' },
      { status: 500 },
    );
  }
}

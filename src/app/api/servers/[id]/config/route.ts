import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashValue } from '@/lib/password';
import { isPrismaUniqueViolation } from '@/lib/prisma-errors';
import { writeAuditLog } from '@/lib/audit-log';

type RouteContext = { params: Promise<{ id: string }> };

const updateConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  hostname: z.string().min(1).max(255).optional(),
  redirectIp: z.string().nullable().optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  apiKey: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  serviceOverrides: z
    .array(
      z.object({
        serviceId: z.number().int(),
        enabled: z.boolean().optional(),
        port: z.coerce.number().int().min(1).max(65535).optional(),
      }),
    )
    .optional(),
});

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const serverId = Number(id);
    if (Number.isNaN(serverId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid server ID' },
        { status: 422 },
      );
    }

    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: {
        services: {
          select: {
            id: true,
            type: true,
            status: true,
            port: true,
            config: true,
          },
        },
      },
    });

    if (!server) {
      return NextResponse.json(
        { success: false, error: 'Server not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: server.id,
        name: server.name,
        hostname: server.hostname,
        port: server.port,
        isActive: server.isActive,
        services: server.services.map((s) => ({
          id: s.id,
          type: s.type,
          status: s.status,
          port: s.port,
          config: s.config,
        })),
        createdAt: server.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('[api/servers/:id/config GET] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch server configuration' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const serverId = Number(id);
    if (Number.isNaN(serverId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid server ID' },
        { status: 422 },
      );
    }

    const body = await request.json();
    const parsed = updateConfigSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { name, hostname, redirectIp, port, apiKey, isActive, serviceOverrides } =
      parsed.data;

    const existing = await prisma.server.findUnique({
      where: { id: serverId },
      include: { services: true },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Server not found' },
        { status: 404 },
      );
    }

    // Update server-level settings
    const serverUpdateData: Record<string, unknown> = {};
    if (name !== undefined) serverUpdateData.name = name;
    if (hostname !== undefined) serverUpdateData.hostname = hostname;
    if (redirectIp !== undefined) serverUpdateData.redirectIp = redirectIp;
    if (port !== undefined) serverUpdateData.port = port;
    if (isActive !== undefined) serverUpdateData.isActive = isActive;

    if (apiKey !== undefined) {
      serverUpdateData.apiKeyHash = await hashValue(apiKey);
    }

    // Apply all updates atomically — server fields, service overrides,
    // and the re-fetch run inside a single transaction so a mid-loop
    // failure rolls back everything.
    const updated = await prisma.$transaction(async (tx) => {
      // Apply service-level overrides
      if (serviceOverrides && serviceOverrides.length > 0) {
        for (const override of serviceOverrides) {
          const belongsToServer = existing.services.some(
            (s) => s.id === override.serviceId,
          );
          if (!belongsToServer) continue;

          const serviceUpdate: Record<string, unknown> = {};
          if (override.port !== undefined) serviceUpdate.port = override.port;
          if (override.enabled !== undefined) {
            serviceUpdate.status = override.enabled ? 'RUNNING' : 'STOPPED';
          }

          if (Object.keys(serviceUpdate).length > 0) {
            await tx.service.update({
              where: { id: override.serviceId },
              data: serviceUpdate,
            });
          }
        }
      }

      // Apply server updates
      if (Object.keys(serverUpdateData).length > 0) {
        await tx.server.update({
          where: { id: serverId },
          data: serverUpdateData,
        });
      }

      // Fetch the updated server with services
      return tx.server.findUnique({
        where: { id: serverId },
        include: {
          services: {
            select: {
              id: true,
              type: true,
              status: true,
              port: true,
              config: true,
            },
          },
        },
      });
    });

    await writeAuditLog({
      action: 'server.config.update',
      resource: 'server',
      resourceId: serverId,
      metadata: {
        changedFields: Object.keys(serverUpdateData).filter(
          (field) => field !== 'apiKeyHash',
        ),
        apiKeyChanged: apiKey !== undefined,
        serviceOverrideCount: serviceOverrides?.length ?? 0,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updated!.id,
        name: updated!.name,
        hostname: updated!.hostname,
        port: updated!.port,
        isActive: updated!.isActive,
        services: updated!.services.map((s) => ({
          id: s.id,
          type: s.type,
          status: s.status,
          port: s.port,
          config: s.config,
        })),
        createdAt: updated!.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('[api/servers/:id/config PUT] Error:', err);

    // The transaction still surfaces Prisma's P2002 unique-constraint
    // violation (e.g. duplicate hostname) — map it to a 409 before the
    // generic 500 fallback so callers keep the specific error class.
    if (isPrismaUniqueViolation(err)) {
      return NextResponse.json(
        { success: false, error: 'Server hostname already exists' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to update server configuration' },
      { status: 500 },
    );
  }
}

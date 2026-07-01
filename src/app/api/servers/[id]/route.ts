import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashValue } from '@/lib/password';
import { writeAuditLog } from '@/lib/audit-log';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { error, validationError } from '@/lib/api-response';

const updateServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  hostname: z.string().min(1).max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  apiKey: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

function serverResponse(server: {
  id: number;
  name: string;
  hostname: string;
  port: number;
  isActive: boolean;
  createdAt: Date;
  services: Array<{
    id: number;
    type: string;
    status: string;
    port: number | null;
  }>;
}) {
  return {
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
    })),
    createdAt: server.createdAt.toISOString(),
  };
}

// ─── GET: Fetch single server ───────────────────────────

export const GET = apiHandler(
  async (_request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const serverId = Number(id);
    if (Number.isNaN(serverId)) {
      return error('Invalid server ID', 422);
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
          },
        },
      },
    });

    if (!server) {
      return error('Server not found', 404);
    }

    return NextResponse.json({ success: true, data: serverResponse(server) });
  },
  'api/servers/[id]',
);

// ─── PUT: Update server ─────────────────────────────────

export const PUT = apiHandler(
  async (request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const serverId = Number(id);
    if (Number.isNaN(serverId)) {
      return error('Invalid server ID', 422);
    }

    const body = await request.json();
    const parsed = updateServerSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { name, hostname, port, apiKey, isActive } = parsed.data;

    const existing = await prisma.server.findUnique({
      where: { id: serverId },
    });
    if (!existing) {
      return error('Server not found', 404);
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (hostname !== undefined) updateData.hostname = hostname;
    if (port !== undefined) updateData.port = port;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (apiKey !== undefined) {
      updateData.apiKeyHash = await hashValue(apiKey);
    }

    const server = await prisma.server.update({
      where: { id: serverId },
      data: updateData,
      include: {
        services: {
          select: {
            id: true,
            type: true,
            status: true,
            port: true,
          },
        },
      },
    });

    await writeAuditLog({
      action: 'server.update',
      resource: 'server',
      resourceId: serverId,
      metadata: {
        name: server.name,
        hostname: server.hostname,
        changedFields: Object.keys(updateData).filter(
          (field) => field !== 'apiKeyHash',
        ),
        apiKeyChanged: apiKey !== undefined,
      },
    });

    return NextResponse.json({ success: true, data: serverResponse(server) });
  },
  'api/servers/[id]',
);

// ─── DELETE: Remove server ──────────────────────────────

export const DELETE = apiHandler(
  async (_request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const serverId = Number(id);
    if (Number.isNaN(serverId)) {
      return error('Invalid server ID', 422);
    }

    const existing = await prisma.server.findUnique({
      where: { id: serverId },
    });
    if (!existing) {
      return error('Server not found', 404);
    }

    await prisma.server.delete({ where: { id: serverId } });

    await writeAuditLog({
      action: 'server.delete',
      resource: 'server',
      resourceId: serverId,
      metadata: { name: existing.name, hostname: existing.hostname },
    });

    return NextResponse.json({ success: true, data: { id: serverId } });
  },
  'api/servers/[id]',
);

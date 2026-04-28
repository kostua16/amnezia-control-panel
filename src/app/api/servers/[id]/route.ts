import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

type RouteContext = { params: Promise<{ id: string }> };

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
  services: Array<{ id: number; type: string; status: string; port: number | null }>;
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

    return NextResponse.json({ success: true, data: serverResponse(server) });
  } catch (err) {
    console.error('[api/servers/:id GET] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch server' },
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
    const parsed = updateServerSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { name, hostname, port, apiKey, isActive } = parsed.data;

    const existing = await prisma.server.findUnique({ where: { id: serverId } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Server not found' },
        { status: 404 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (hostname !== undefined) updateData.hostname = hostname;
    if (port !== undefined) updateData.port = port;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (apiKey !== undefined) {
      const bcrypt = await import('bcryptjs');
      updateData.apiKeyHash = await bcrypt.hash(apiKey, 10);
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

    return NextResponse.json({ success: true, data: serverResponse(server) });
  } catch (err) {
    console.error('[api/servers/:id PUT] Error:', err);

    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { success: false, error: 'Server hostname already exists' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to update server' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const serverId = Number(id);
    if (Number.isNaN(serverId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid server ID' },
        { status: 422 },
      );
    }

    const existing = await prisma.server.findUnique({ where: { id: serverId } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Server not found' },
        { status: 404 },
      );
    }

    await prisma.server.delete({ where: { id: serverId } });

    return NextResponse.json({ success: true, data: { id: serverId } });
  } catch (err) {
    console.error('[api/servers/:id DELETE] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete server' },
      { status: 500 },
    );
  }
}

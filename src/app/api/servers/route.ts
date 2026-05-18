import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const createServerSchema = z.object({
  name: z
    .string()
    .min(1, 'Server name is required')
    .max(100, 'Server name must be at most 100 characters'),
  hostname: z
    .string()
    .min(1, 'Hostname is required')
    .max(255, 'Hostname must be at most 255 characters'),
  port: z.coerce.number().int().min(1).max(65535).optional().default(22),
  apiKey: z.string().min(1, 'API key is required'),
});

export async function GET() {
  try {
    const servers = await prisma.server.findMany({
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
      orderBy: { createdAt: 'asc' },
    });

    const data = servers.map((server) => ({
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
    }));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[api/servers] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch servers' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createServerSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { name, hostname, port, apiKey } = parsed.data;

    // Hash the API key before storing
    const bcrypt = await import('bcryptjs');
    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    const server = await prisma.server.create({
      data: {
        name,
        hostname,
        port,
        apiKeyHash,
      },
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

    return NextResponse.json(
      {
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
          })),
          createdAt: server.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/servers POST] Error:', err);

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
      { success: false, error: 'Failed to create server' },
      { status: 500 },
    );
  }
}

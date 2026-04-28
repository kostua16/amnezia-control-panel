import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { testConnection } from '@/lib/server-connection';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const serverId = Number(id);
    if (Number.isNaN(serverId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid server ID' },
        { status: 422 },
      );
    }

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      return NextResponse.json(
        { success: false, error: 'Server not found' },
        { status: 404 },
      );
    }

    const result = await testConnection({
      id: server.id,
      name: server.name,
      hostname: server.hostname,
      port: server.port,
      isActive: server.isActive,
      createdAt: server.createdAt,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[api/servers/:id/test] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Connection test failed' },
      { status: 500 },
    );
  }
}

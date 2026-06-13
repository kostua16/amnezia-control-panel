import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit-log';
import { apiHandler } from '@/lib/api-handler';
import { validationError } from '@/lib/api-response';

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

export const GET = apiHandler(async () => {
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
}, 'api/servers');

export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = createServerSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
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

  await writeAuditLog({
    action: 'server.create',
    resource: 'server',
    resourceId: server.id,
    metadata: { name: server.name, hostname: server.hostname, port },
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
}, 'api/servers');

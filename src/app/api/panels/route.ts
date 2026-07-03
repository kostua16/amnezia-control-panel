import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit-log';
import { hashValue } from '@/lib/password';
import { apiHandler } from '@/lib/api-handler';
import { invalidatePanelListCache } from '@/lib/panel-health-checker';
import { validationError } from '@/lib/api-response';

const createPanelSchema = z.object({
  name: z
    .string()
    .min(1, 'Panel name is required')
    .max(100, 'Panel name must be at most 100 characters'),
  panelUrl: z
    .string()
    .min(1, 'Panel URL is required')
    .max(500, 'Panel URL must be at most 500 characters')
    .url('Invalid URL format'),
  apiKey: z.string().min(1, 'API key is required'),
});

export const GET = apiHandler(async () => {
  const panels = await prisma.remotePanel.findMany({
    orderBy: { createdAt: 'asc' },
  });

  const data = panels.map((panel) => ({
    id: panel.id,
    name: panel.name,
    panelUrl: panel.panelUrl,
    isActive: panel.isActive,
    createdAt: panel.createdAt.toISOString(),
    updatedAt: panel.updatedAt.toISOString(),
  }));

  return NextResponse.json({ success: true, data });
}, 'api/panels');

export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = createPanelSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { name, panelUrl, apiKey } = parsed.data;

  const apiKeyHash = await hashValue(apiKey);

  const panel = await prisma.remotePanel.create({
    data: { name, panelUrl, apiKeyHash },
  });

  invalidatePanelListCache();

  await writeAuditLog({
    action: 'panel.create',
    resource: 'remotePanel',
    resourceId: panel.id,
    metadata: { name: panel.name, panelUrl: panel.panelUrl },
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        id: panel.id,
        name: panel.name,
        panelUrl: panel.panelUrl,
        isActive: panel.isActive,
        createdAt: panel.createdAt.toISOString(),
        updatedAt: panel.updatedAt.toISOString(),
      },
    },
    { status: 201 },
  );
}, 'api/panels');

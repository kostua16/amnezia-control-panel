import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashValue } from '@/lib/password';
import { writeAuditLog } from '@/lib/audit-log';
import {
  evictPanel,
  invalidatePanelListCache,
} from '@/lib/panel-health-checker';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { error, validationError } from '@/lib/api-response';
import { isPrismaUniqueViolation } from '@/lib/prisma-errors';

const updatePanelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  panelUrl: z.string().min(1).max(500).url().optional(),
  apiKey: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

function panelResponse(panel: {
  id: number;
  name: string;
  panelUrl: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: panel.id,
    name: panel.name,
    panelUrl: panel.panelUrl,
    isActive: panel.isActive,
    createdAt: panel.createdAt.toISOString(),
    updatedAt: panel.updatedAt.toISOString(),
  };
}

// ─── GET: Fetch single panel ───────────────────────────

export const GET = apiHandler(
  async (_request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const panelId = Number(id);
    if (Number.isNaN(panelId)) {
      return error('Invalid panel ID', 422);
    }

    const panel = await prisma.remotePanel.findUnique({
      where: { id: panelId },
    });

    if (!panel) {
      return error('Panel not found', 404);
    }

    return NextResponse.json({ success: true, data: panelResponse(panel) });
  },
  'api/panels/[id]',
);

// ─── PUT: Update panel ──────────────────────────────────

export const PUT = apiHandler(
  async (request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const panelId = Number(id);
    if (Number.isNaN(panelId)) {
      return error('Invalid panel ID', 422);
    }

    const body = await request.json();
    const parsed = updatePanelSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { name, panelUrl, apiKey, isActive } = parsed.data;

    const existing = await prisma.remotePanel.findUnique({
      where: { id: panelId },
    });
    if (!existing) {
      return error('Panel not found', 404);
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (panelUrl !== undefined) updateData.panelUrl = panelUrl;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (apiKey !== undefined) {
      updateData.apiKeyHash = await hashValue(apiKey);
    }

    try {
      const updated = await prisma.remotePanel.update({
        where: { id: panelId },
        data: updateData,
      });

      invalidatePanelListCache();

      await writeAuditLog({
        action: 'panel.update',
        resource: 'remotePanel',
        resourceId: panelId,
        metadata: {
          name: updated.name,
          panelUrl: updated.panelUrl,
          changedFields: Object.keys(updateData).filter(
            (field) => field !== 'apiKeyHash',
          ),
          apiKeyChanged: apiKey !== undefined,
        },
      });

      return NextResponse.json({ success: true, data: panelResponse(updated) });
    } catch (err) {
      // Surface the unique constraint as a field-specific message; let
      // apiHandler map any other Prisma/unknown error.
      if (isPrismaUniqueViolation(err)) {
        return error('Panel URL already exists', 409);
      }
      throw err;
    }
  },
  'api/panels/[id]',
);

// ─── DELETE: Remove panel ──────────────────────────────

export const DELETE = apiHandler(
  async (_request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const panelId = Number(id);
    if (Number.isNaN(panelId)) {
      return error('Invalid panel ID', 422);
    }

    const existing = await prisma.remotePanel.findUnique({
      where: { id: panelId },
    });
    if (!existing) {
      return error('Panel not found', 404);
    }

    await prisma.remotePanel.delete({ where: { id: panelId } });

    // Evict all in-memory state for this panel
    evictPanel(panelId);

    await writeAuditLog({
      action: 'panel.delete',
      resource: 'remotePanel',
      resourceId: panelId,
      metadata: { name: existing.name, panelUrl: existing.panelUrl },
    });

    return NextResponse.json({ success: true, data: { id: panelId } });
  },
  'api/panels/[id]',
);

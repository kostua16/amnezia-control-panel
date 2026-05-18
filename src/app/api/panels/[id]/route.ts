import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

type RouteContext = { params: Promise<{ id: string }> };

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

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const panelId = Number(id);
    if (Number.isNaN(panelId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid panel ID' },
        { status: 422 },
      );
    }

    const panel = await prisma.remotePanel.findUnique({
      where: { id: panelId },
    });

    if (!panel) {
      return NextResponse.json(
        { success: false, error: 'Panel not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: panelResponse(panel) });
  } catch (err) {
    console.error('[api/panels/:id GET] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch remote panel' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const panelId = Number(id);
    if (Number.isNaN(panelId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid panel ID' },
        { status: 422 },
      );
    }

    const body = await request.json();
    const parsed = updatePanelSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { name, panelUrl, apiKey, isActive } = parsed.data;

    const existing = await prisma.remotePanel.findUnique({
      where: { id: panelId },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Panel not found' },
        { status: 404 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (panelUrl !== undefined) updateData.panelUrl = panelUrl;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (apiKey !== undefined) {
      const bcrypt = await import('bcryptjs');
      updateData.apiKeyHash = await bcrypt.hash(apiKey, 10);
    }

    const updated = await prisma.remotePanel.update({
      where: { id: panelId },
      data: updateData,
    });

    return NextResponse.json({ success: true, data: panelResponse(updated) });
  } catch (err) {
    console.error('[api/panels/:id PUT] Error:', err);

    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { success: false, error: 'Panel URL already exists' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to update remote panel' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const panelId = Number(id);
    if (Number.isNaN(panelId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid panel ID' },
        { status: 422 },
      );
    }

    const existing = await prisma.remotePanel.findUnique({
      where: { id: panelId },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Panel not found' },
        { status: 404 },
      );
    }

    await prisma.remotePanel.delete({ where: { id: panelId } });

    return NextResponse.json({ success: true, data: { id: panelId } });
  } catch (err) {
    console.error('[api/panels/:id DELETE] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete remote panel' },
      { status: 500 },
    );
  }
}

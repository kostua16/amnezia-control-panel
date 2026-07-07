import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPanelStatus } from '@/lib/panel-health-checker';

type RouteContext = { params: Promise<{ id: string }> };

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

    const { status } = await getPanelStatus(panelId);

    return NextResponse.json({
      success: true,
      data: {
        panelId,
        status,
      },
    });
  } catch (err) {
    console.error('[api/panels/:id/status] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch panel status' },
      { status: 500 },
    );
  }
}

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

    const { status, lastRecord } = await getPanelStatus(panelId);

    // Also fetch last 10 history records for display
    const history = await prisma.panelConnectionHistory.findMany({
      where: { panelId },
      orderBy: { checkedAt: 'desc' },
      take: 10,
    });

    return NextResponse.json({
      success: true,
      data: {
        panelId,
        status,
        lastRecord,
        history: history.map((h) => ({
          id: h.id,
          success: h.success,
          latencyMs: h.latencyMs,
          message: h.message,
          version: h.version,
          checkedAt: h.checkedAt.toISOString(),
        })),
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

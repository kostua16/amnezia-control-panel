import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { testPanel } from '@/lib/panel-health-checker';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const panelId = Number(id);
    if (Number.isNaN(panelId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid panel ID' },
        { status: 422 },
      );
    }

    const panel = await prisma.remotePanel.findUnique({ where: { id: panelId } });
    if (!panel) {
      return NextResponse.json(
        { success: false, error: 'Panel not found' },
        { status: 404 },
      );
    }

    const result = await testPanel(panelId);

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[api/panels/:id/test] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Connection test failed' },
      { status: 500 },
    );
  }
}

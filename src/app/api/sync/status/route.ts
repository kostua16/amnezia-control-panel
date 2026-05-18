import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isPanelInFallback } from '@/lib/panel-health-checker';

// ─── GET /api/sync/status ──────────────────────────────

/**
 * Return the cached config and sync status for a panel.
 * Optional query param: panelId (integer). Defaults to null (local panel).
 */
export async function GET(request: NextRequest) {
  try {
    const panelIdParam = request.nextUrl.searchParams.get('panelId');
    const panelId = panelIdParam ? parseInt(panelIdParam, 10) : null;

    // Check fallback status (use 0 as sentinel for null panelId)
    const inFallback = isPanelInFallback(panelId ?? 0);

    // Fetch cached config from DB
    const cachedConfig = await prisma.cachedPanelConfig.findUnique({
      where: { panelId: panelId ?? 0 },
    });

    if (!cachedConfig) {
      return NextResponse.json({
        success: true,
        data: {
          inFallback,
          configVersion: null,
          config: null,
          receivedAt: null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        inFallback,
        configVersion: cachedConfig.configVersion,
        config: cachedConfig.config,
        receivedAt: cachedConfig.receivedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('[api/sync/status] Failed to fetch sync status:', err);
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error ? err.message : 'Failed to fetch sync status',
      },
      { status: 500 },
    );
  }
}

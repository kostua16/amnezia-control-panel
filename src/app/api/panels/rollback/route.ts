import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rollbackPanelConfigWithPush } from '@/lib/rollback-manager';

// ─── Request Validation ──────────────────────────────────

const rollbackRequestSchema = z.object({
  panelId: z.number().int().positive(),
  apiKey: z.string().min(1),
});

// ─── POST /api/panels/rollback ───────────────────────────

/**
 * Rollback a panel's config to its previous version and re-push to the remote panel.
 * Single-click rollback per CONTEXT.md decision D-02 (no confirmation dialog).
 * Requires admin session auth (T-11.4-06).
 */
export async function POST(request: NextRequest) {
  try {
    // Auth handled by middleware; proceed directly to request handling

    // Parse and validate request body
    const body = await request.json();
    const parsed = rollbackRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        },
        { status: 422 },
      );
    }

    const { panelId, apiKey } = parsed.data;

    // Execute rollback with re-push
    const result = await rollbackPanelConfigWithPush(panelId, apiKey);

    if (result.success) {
      return NextResponse.json({
        success: true,
        data: {
          configVersion: result.configVersion,
          message: `Config rolled back to version ${result.configVersion} and pushed to panel`,
        },
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error?.message ?? 'Rollback failed',
        details: result.error,
      });
    }
  } catch (err) {
    console.error('[api/panels/rollback] Error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Rollback failed',
      },
      { status: 500 },
    );
  }
}

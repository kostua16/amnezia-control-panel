import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jwtVerify } from 'jose';
import { rollbackPanelConfigWithPush } from '@/lib/rollback-manager';

// ─── JWT Auth Helper ─────────────────────────────────────

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return new TextEncoder().encode(secret);
}

async function authenticateAdmin(request: NextRequest): Promise<{ authenticated: boolean; username?: string }> {
  const token = request.cookies.get('auth-token')?.value;
  if (!token) return { authenticated: false };

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return { authenticated: true, username: payload.username as string };
  } catch {
    return { authenticated: false };
  }
}

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
    // Auth check
    const auth = await authenticateAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 },
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = rollbackRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', details: parsed.error.flatten() },
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
      { success: false, error: err instanceof Error ? err.message : 'Rollback failed' },
      { status: 500 },
    );
  }
}

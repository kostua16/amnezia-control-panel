import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveGeoRoute } from '@/lib/geo-routing';

const resolveBodySchema = z.object({
  ip: z.string().min(1, 'IP address is required'),
});

/**
 * POST /api/routing/geo-resolve
 *
 * Resolve a destination IP to a geo-routing decision.
 * Returns the matched rule (if any), action (ALLOW/BLOCK/ROUTE),
 * and optional chainId for ROUTE actions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = resolveBodySchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const result = await resolveGeoRoute(parsed.data.ip);

    return NextResponse.json({
      success: true,
      data: {
        matched: result.matched,
        action: result.action,
        rule: result.rule ?? null,
        chainId: result.chainId ?? null,
      },
    });
  } catch (err) {
    console.error('[api/routing/geo-resolve POST] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Geo-routing resolve failed' },
      { status: 500 },
    );
  }
}

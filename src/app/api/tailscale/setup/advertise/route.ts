import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { advertiseRoutes, getStatus } from '@/lib/tailscale';

// ─── Schema ─────────────────────────────────────────────

const CIDR_REGEX =
  /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\/[0-9]{1,2}$/;

const advertiseSchema = z.object({
  subnets: z
    .array(
      z.string().regex(
        CIDR_REGEX,
        'Invalid CIDR format. Expected: x.x.x.x/y',
      ),
    )
    .min(1, 'At least one subnet is required'),
});

// ─── POST handler ──────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = advertiseSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { subnets } = parsed.data;

    // Call tailscale.ts (also validates CIDRs internally -- double validation per T-11.1-05)
    const result = await advertiseRoutes(subnets);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.message },
        { status: 500 },
      );
    }

    // Confirm routes are reflected in status
    const status = await getStatus();
    const allowedIPs = status?.Self?.AllowedIPs ?? [];
    const primaryRoutes = status?.Self?.PrimaryRoutes ?? [];
    const allRoutes = [...allowedIPs, ...primaryRoutes];

    const matchedRoutes = allRoutes.filter((r) => subnets.includes(r));

    return NextResponse.json({
      success: true,
      data: {
        subnets,
        matchedRoutes,
        message:
          matchedRoutes.length === subnets.length
            ? 'Routes advertised successfully'
            : 'Routes advertised. Note: some routes may take a moment to appear in status.',
      },
    });
  } catch (err) {
    console.error('[api/tailscale/setup/advertise] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to advertise routes' },
      { status: 500 },
    );
  }
}

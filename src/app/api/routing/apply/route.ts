import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyRoutingRules, applyAllRules } from '@/lib/rule-enforcement';

const applyBodySchema = z.object({
  userId: z.number().int().positive().optional(),
});

// ─── POST: Trigger rule application ──────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = applyBodySchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const result = parsed.data.userId
      ? await applyRoutingRules(parsed.data.userId)
      : await applyAllRules();

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rule application completed with errors',
          data: {
            appliedCount: result.appliedCount,
            errors: result.errors,
            awgConfig: result.awgConfig,
            threeXuiConfig: result.threeXuiConfig,
          },
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        appliedCount: result.appliedCount,
        rules: result.rules,
        awgConfig: result.awgConfig,
        threeXuiConfig: result.threeXuiConfig,
      },
    });
  } catch (err) {
    console.error('[api/routing/apply POST] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to apply routing rules' },
      { status: 500 },
    );
  }
}

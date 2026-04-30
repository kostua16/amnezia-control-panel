import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const reorderItemSchema = z.object({
  id: z.number().int().positive(),
  priority: z.number().int().min(0),
});

const reorderSchema = z.object({
  rules: z.array(reorderItemSchema).min(1, 'At least one rule is required'),
});

// ─── POST: Batch update geo-routing rule priorities ──────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = reorderSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { rules } = parsed.data;
    const ruleIds = rules.map((r) => r.id);

    // Verify all rule IDs exist
    const existingRules = await prisma.geoRoutingRule.findMany({
      where: { id: { in: ruleIds } },
      select: { id: true },
    });

    const existingIds = new Set(existingRules.map((r) => r.id));
    const missingIds = ruleIds.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      return NextResponse.json(
        { success: false, error: `Rules not found: ${missingIds.join(', ')}` },
        { status: 404 },
      );
    }

    // Batch update priorities in transaction
    await prisma.$transaction(
      rules.map((rule) =>
        prisma.geoRoutingRule.update({
          where: { id: rule.id },
          data: { priority: rule.priority, updatedAt: new Date() },
        }),
      ),
    );

    return NextResponse.json({
      success: true,
      data: {
        updated: rules.length,
        rules: rules.map((r) => ({ id: r.id, priority: r.priority })),
      },
    });
  } catch (err) {
    console.error('[api/routing/geo/reorder POST] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to reorder geo-routing rules' },
      { status: 500 },
    );
  }
}

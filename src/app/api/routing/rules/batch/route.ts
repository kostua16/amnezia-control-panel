import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit-log';

// ─── POST: Batch create rules ──────────────────────────────

const batchCreateRuleSchema = z.object({
  rules: z
    .array(
      z.object({
        protocol: z.enum([
          'ANY',
          'WIREGUARD',
          'VLESS',
          'VMESS',
          'TROJAN',
          'SHADOWSOCKS',
        ]),
        destination: z.string().min(1),
        action: z.enum(['ALLOW', 'BLOCK', 'ROUTE']),
        priority: z.number().int().min(0).default(0),
        isActive: z.boolean().default(true),
        userId: z.number().int().positive().nullable().optional().default(null),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = batchCreateRuleSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { rules } = parsed.data;

    // Validate userIds exist
    const userIds = rules.filter((r) => r.userId).map((r) => r.userId!);
    if (userIds.length > 0) {
      const uniqueIds = [...new Set(userIds)];
      const existingUsers = await prisma.user.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      const existingIds = new Set(existingUsers.map((u) => u.id));
      const missingIds = uniqueIds.filter((id) => !existingIds.has(id));
      if (missingIds.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Users not found: ${missingIds.join(', ')}`,
          },
          { status: 404 },
        );
      }
    }

    // Batch create in transaction
    const created = await prisma.$transaction(
      rules.map((rule) => prisma.routingRule.create({ data: rule })),
    );

    await writeAuditLog({
      action: 'routing.rule.batch_create',
      resource: 'routingRule',
      metadata: { created: created.length, ids: created.map((r) => r.id) },
    });

    return NextResponse.json(
      { success: true, data: { created: created.length, rules: created } },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/routing/rules/batch POST] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to batch create routing rules' },
      { status: 500 },
    );
  }
}

// ─── DELETE: Batch delete rules ────────────────────────────

const batchDeleteSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = batchDeleteSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { ids } = parsed.data;

    const result = await prisma.routingRule.deleteMany({
      where: { id: { in: ids } },
    });

    await writeAuditLog({
      action: 'routing.rule.batch_delete',
      resource: 'routingRule',
      metadata: { requestedIds: ids, deleted: result.count },
    });

    return NextResponse.json({
      success: true,
      data: { deleted: result.count },
    });
  } catch (err) {
    console.error('[api/routing/rules/batch DELETE] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to batch delete routing rules' },
      { status: 500 },
    );
  }
}

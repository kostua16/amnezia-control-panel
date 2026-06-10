import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit-log';

const validProtocols = [
  'ANY',
  'WIREGUARD',
  'VLESS',
  'VMESS',
  'TROJAN',
  'SHADOWSOCKS',
] as const;

const validActions = ['ALLOW', 'BLOCK', 'ROUTE'] as const;

const createRuleSchema = z.object({
  protocol: z.enum(validProtocols),
  destination: z.string().min(1, 'Destination is required'),
  action: z.enum(validActions),
  priority: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  userId: z.number().int().positive().nullable().optional().default(null),
});

// ─── GET: List routing rules ─────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const isActive = searchParams.get('isActive');

    const where: Record<string, unknown> = {};

    if (userId) {
      where.userId = parseInt(userId, 10);
    }

    if (isActive !== null && isActive !== undefined && isActive !== '') {
      where.isActive = isActive === 'true';
    }

    const rules = await prisma.routingRule.findMany({
      where,
      orderBy: { priority: 'asc' },
      include: {
        user: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: rules.map((rule) => ({
        id: rule.id,
        protocol: rule.protocol,
        destination: rule.destination,
        action: rule.action,
        priority: rule.priority,
        isActive: rule.isActive,
        userId: rule.userId,
        user: rule.user
          ? {
              id: rule.user.id,
              username: rule.user.username,
              displayName: rule.user.displayName,
            }
          : null,
        createdAt: rule.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[api/routing/rules GET] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch routing rules' },
      { status: 500 },
    );
  }
}

// ─── POST: Create routing rule ───────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createRuleSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { userId, ...ruleData } = parsed.data;

    // Validate user exists if userId is provided
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'User not found' },
          { status: 404 },
        );
      }
    }

    const rule = await prisma.routingRule.create({
      data: {
        ...ruleData,
        userId,
      },
    });

    await writeAuditLog({
      action: 'routing.rule.create',
      resource: 'routingRule',
      resourceId: rule.id,
      metadata: {
        protocol: rule.protocol,
        destination: rule.destination,
        action: rule.action,
        priority: rule.priority,
        userId: rule.userId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: rule.id,
          protocol: rule.protocol,
          destination: rule.destination,
          action: rule.action,
          priority: rule.priority,
          isActive: rule.isActive,
          userId: rule.userId,
          createdAt: rule.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/routing/rules POST] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to create routing rule' },
      { status: 500 },
    );
  }
}

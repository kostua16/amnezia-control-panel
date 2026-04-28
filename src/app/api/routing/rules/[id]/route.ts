import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const validProtocols = [
  'ANY',
  'WIREGUARD',
  'VLESS',
  'VMESS',
  'TROJAN',
  'SHADOWSOCKS',
] as const;

const validActions = ['ALLOW', 'BLOCK', 'ROUTE'] as const;

const updateRuleSchema = z.object({
  protocol: z.enum(validProtocols).optional(),
  destination: z.string().min(1).optional(),
  action: z.enum(validActions).optional(),
  priority: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  userId: z.number().int().positive().nullable().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── GET: Fetch single routing rule ──────────────────────

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;
    const ruleId = parseInt(id, 10);

    if (isNaN(ruleId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid rule ID' },
        { status: 422 },
      );
    }

    const rule = await prisma.routingRule.findUnique({
      where: { id: ruleId },
      include: {
        user: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    if (!rule) {
      return NextResponse.json(
        { success: false, error: 'Rule not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
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
      },
    });
  } catch (err) {
    console.error('[api/routing/rules/[id] GET] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch routing rule' },
      { status: 500 },
    );
  }
}

// ─── PUT: Update routing rule ────────────────────────────

export async function PUT(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;
    const ruleId = parseInt(id, 10);

    if (isNaN(ruleId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid rule ID' },
        { status: 422 },
      );
    }

    const body = await request.json();
    const parsed = updateRuleSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    // Check rule exists
    const existing = await prisma.routingRule.findUnique({
      where: { id: ruleId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Rule not found' },
        { status: 404 },
      );
    }

    const { userId, ...ruleData } = parsed.data;

    // Validate user exists if userId is provided
    if (userId !== undefined && userId !== null) {
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

    const rule = await prisma.routingRule.update({
      where: { id: ruleId },
      data: {
        ...ruleData,
        ...(userId !== undefined ? { userId } : {}),
      },
      include: {
        user: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
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
      },
    });
  } catch (err) {
    console.error('[api/routing/rules/[id] PUT] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update routing rule' },
      { status: 500 },
    );
  }
}

// ─── DELETE: Remove routing rule ─────────────────────────

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;
    const ruleId = parseInt(id, 10);

    if (isNaN(ruleId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid rule ID' },
        { status: 422 },
      );
    }

    // Check rule exists
    const existing = await prisma.routingRule.findUnique({
      where: { id: ruleId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Rule not found' },
        { status: 404 },
      );
    }

    await prisma.routingRule.delete({
      where: { id: ruleId },
    });

    return NextResponse.json({
      success: true,
      data: { id: ruleId },
    });
  } catch (err) {
    console.error('[api/routing/rules/[id] DELETE] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete routing rule' },
      { status: 500 },
    );
  }
}

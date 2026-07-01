import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit-log';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { error, validationError } from '@/lib/api-response';

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

// ─── GET: Fetch single routing rule ──────────────────────

export const GET = apiHandler(
  async (_request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const ruleId = parseInt(id, 10);

    if (isNaN(ruleId)) {
      return error('Invalid rule ID', 422);
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
      return error('Rule not found', 404);
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
  },
  'api/routing/rules/[id]',
);

// ─── PUT: Update routing rule ────────────────────────────

export const PUT = apiHandler(
  async (request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const ruleId = parseInt(id, 10);

    if (isNaN(ruleId)) {
      return error('Invalid rule ID', 422);
    }

    const body = await request.json();
    const parsed = updateRuleSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    // Check rule exists
    const existing = await prisma.routingRule.findUnique({
      where: { id: ruleId },
    });

    if (!existing) {
      return error('Rule not found', 404);
    }

    const { userId, ...ruleData } = parsed.data;

    // Validate user exists if userId is provided
    if (userId !== undefined && userId !== null) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        return error('User not found', 404);
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

    await writeAuditLog({
      action: 'routing.rule.update',
      resource: 'routingRule',
      resourceId: ruleId,
      metadata: {
        changedFields: Object.keys(ruleData).concat(
          userId !== undefined ? ['userId'] : [],
        ),
        destination: rule.destination,
        action: rule.action,
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
  },
  'api/routing/rules/[id]',
);

// ─── DELETE: Remove routing rule ─────────────────────────

export const DELETE = apiHandler(
  async (_request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const ruleId = parseInt(id, 10);

    if (isNaN(ruleId)) {
      return error('Invalid rule ID', 422);
    }

    // Check rule exists
    const existing = await prisma.routingRule.findUnique({
      where: { id: ruleId },
    });

    if (!existing) {
      return error('Rule not found', 404);
    }

    await prisma.routingRule.delete({
      where: { id: ruleId },
    });

    await writeAuditLog({
      action: 'routing.rule.delete',
      resource: 'routingRule',
      resourceId: ruleId,
      metadata: {
        destination: existing.destination,
        action: existing.action,
        userId: existing.userId,
      },
    });

    return NextResponse.json({
      success: true,
      data: { id: ruleId },
    });
  },
  'api/routing/rules/[id]',
);

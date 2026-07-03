import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { invalidateGeoRuleCache } from '@/lib/geo-routing';
import { writeAuditLog } from '@/lib/audit-log';
import { apiHandler, type RouteContext } from '@/lib/api-handler';
import { error, validationError } from '@/lib/api-response';

const geoTargetSchema = z
  .object({
    countryCode: z.string().length(2).optional(),
    region: z.string().optional(),
    special: z.enum(['domestic', 'foreign']).optional(),
  })
  .refine(
    (t) => t.countryCode || t.region || t.special,
    'At least one target field is required',
  );

const updateGeoRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  target: geoTargetSchema.optional(),
  action: z.enum(['ALLOW', 'BLOCK', 'ROUTE']).optional(),
  chainId: z.number().int().positive().nullable().optional(),
  priority: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/** Derive matchType from which target field is set */
function deriveMatchType(
  target: z.infer<typeof geoTargetSchema>,
): 'country' | 'region' | 'special' {
  if (target.countryCode) return 'country';
  if (target.region) return 'region';
  if (target.special) return 'special';
  return 'country';
}

/** Map a Prisma GeoRoutingRule row to the GeoRoutingRule API shape */
function mapToGeoRoutingRule(row: {
  id: number;
  name: string;
  matchType: string;
  countryCode: string | null;
  region: string | null;
  special: string | null;
  action: string;
  chainId: number | null;
  priority: number;
  isActive: boolean;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    matchType: row.matchType as 'country' | 'region' | 'special',
    target: {
      countryCode: row.countryCode ?? undefined,
      region: row.region ?? undefined,
      special: (row.special as 'domestic' | 'foreign') ?? undefined,
    },
    action: row.action as 'ALLOW' | 'BLOCK' | 'ROUTE',
    chainId: row.chainId ?? undefined,
    priority: row.priority,
    isActive: row.isActive,
    source: row.source as 'custom' | 'imported' | 'template',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── GET: Fetch single geo-routing rule ──────────────────

export const GET = apiHandler(
  async (_request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const ruleId = Number(id);
    if (Number.isNaN(ruleId)) {
      return error('Invalid rule ID', 400);
    }

    const rule = await prisma.geoRoutingRule.findUnique({
      where: { id: ruleId },
    });

    if (!rule) {
      return error('Rule not found', 404);
    }

    return NextResponse.json({
      success: true,
      data: mapToGeoRoutingRule(rule),
    });
  },
  'api/routing/geo/[id]',
);

// ─── PUT: Update geo-routing rule ───────────────────────

export const PUT = apiHandler(
  async (request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const ruleId = Number(id);
    if (Number.isNaN(ruleId)) {
      return error('Invalid rule ID', 400);
    }

    const existing = await prisma.geoRoutingRule.findUnique({
      where: { id: ruleId },
    });
    if (!existing) {
      return error('Rule not found', 404);
    }

    const body = await request.json();
    const parsed = updateGeoRuleSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { name, target, action, chainId, priority, isActive } = parsed.data;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (action !== undefined) updateData.action = action;
    if (chainId !== undefined) updateData.chainId = chainId;
    if (priority !== undefined) updateData.priority = priority;
    if (isActive !== undefined) updateData.isActive = isActive;

    // If target is provided, re-derive matchType and target fields
    if (target) {
      const matchType = deriveMatchType(target);
      updateData.matchType = matchType;
      updateData.countryCode = target.countryCode ?? null;
      updateData.region = target.region ?? null;
      updateData.special = target.special ?? null;
    }

    const rule = await prisma.geoRoutingRule.update({
      where: { id: ruleId },
      data: updateData,
    });

    invalidateGeoRuleCache();

    await writeAuditLog({
      action: 'routing.geo.update',
      resource: 'geoRoutingRule',
      resourceId: ruleId,
      metadata: {
        name: rule.name,
        changedFields: Object.keys(updateData),
        action: rule.action,
        priority: rule.priority,
      },
    });

    return NextResponse.json({
      success: true,
      data: mapToGeoRoutingRule(rule),
    });
  },
  'api/routing/geo/[id]',
);

// ─── DELETE: Remove geo-routing rule ────────────────────

export const DELETE = apiHandler(
  async (_request: NextRequest, context: RouteContext<{ id: string }>) => {
    const { id } = await context.params;
    const ruleId = Number(id);
    if (Number.isNaN(ruleId)) {
      return error('Invalid rule ID', 400);
    }

    const existing = await prisma.geoRoutingRule.findUnique({
      where: { id: ruleId },
    });
    if (!existing) {
      return error('Rule not found', 404);
    }

    await prisma.geoRoutingRule.delete({ where: { id: ruleId } });

    invalidateGeoRuleCache();

    await writeAuditLog({
      action: 'routing.geo.delete',
      resource: 'geoRoutingRule',
      resourceId: ruleId,
      metadata: {
        name: existing.name,
        matchType: existing.matchType,
        action: existing.action,
      },
    });

    return NextResponse.json({ success: true, data: { id: ruleId } });
  },
  'api/routing/geo/[id]',
);

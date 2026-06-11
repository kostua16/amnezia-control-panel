import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ensureGeoRulesMigrated } from '@/lib/geo-rule-migration';
import { writeAuditLog } from '@/lib/audit-log';

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

const createGeoRuleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  target: geoTargetSchema,
  action: z.enum(['ALLOW', 'BLOCK', 'ROUTE']),
  chainId: z.number().int().positive().optional(),
  priority: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  source: z.enum(['custom', 'imported', 'template']).default('custom'),
});

/** Derive matchType from which target field is set */
function deriveMatchType(
  target: z.infer<typeof geoTargetSchema>,
): 'country' | 'region' | 'special' {
  if (target.countryCode) return 'country';
  if (target.region) return 'region';
  if (target.special) return 'special';
  // Should not reach here due to Zod refine
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

export async function GET() {
  try {
    await ensureGeoRulesMigrated();

    const rules = await prisma.geoRoutingRule.findMany({
      orderBy: { priority: 'asc' },
    });

    return NextResponse.json({
      success: true,
      data: rules.map(mapToGeoRoutingRule),
    });
  } catch (err) {
    console.error('[api/routing/geo] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch geo-routing rules' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createGeoRuleSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { name, target, action, chainId, priority, isActive, source } =
      parsed.data;
    const matchType = deriveMatchType(target);

    const rule = await prisma.geoRoutingRule.create({
      data: {
        name,
        matchType,
        countryCode: target.countryCode ?? null,
        region: target.region ?? null,
        special: target.special ?? null,
        action,
        chainId: chainId ?? null,
        priority,
        isActive,
        source,
      },
    });

    await writeAuditLog({
      action: 'routing.geo.create',
      resource: 'geoRoutingRule',
      resourceId: rule.id,
      metadata: {
        name: rule.name,
        matchType: rule.matchType,
        action: rule.action,
        priority: rule.priority,
      },
    });

    return NextResponse.json(
      { success: true, data: mapToGeoRoutingRule(rule) },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/routing/geo] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to create geo-routing rule' },
      { status: 500 },
    );
  }
}

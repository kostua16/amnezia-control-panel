import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

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

// Shared in-memory store reference (same module as parent route)
// In production, use Prisma with a proper GeoRoutingRule model
const geoRules: Array<{
  id: number;
  name: string;
  target: z.infer<typeof geoTargetSchema>;
  action: 'ALLOW' | 'BLOCK' | 'ROUTE';
  chainId?: number;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}> = [];

// NOTE: This is a separate route handler module. In production,
// geo rules would be stored in the database and accessed via Prisma.
// For now, import from the parent is not possible, so we export
// a helper that the parent route would use.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ruleId = Number(id);
    if (Number.isNaN(ruleId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid rule ID' },
        { status: 400 },
      );
    }

    // In production: await prisma.geoRoutingRule.findUnique({ where: { id: ruleId } })
    // For in-memory demo, return 404
    return NextResponse.json(
      { success: false, error: 'Rule not found (in-memory store, access via GET /api/routing/geo)' },
      { status: 404 },
    );
  } catch (err) {
    console.error('[api/routing/geo/[id]] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch geo-routing rule' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ruleId = Number(id);
    if (Number.isNaN(ruleId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid rule ID' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const parsed = updateGeoRuleSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    // In production: await prisma.geoRoutingRule.update({ where: { id: ruleId }, data: parsed.data })
    return NextResponse.json(
      { success: false, error: 'In-memory store does not support PUT. Use database model.' },
      { status: 501 },
    );
  } catch (err) {
    console.error('[api/routing/geo/[id]] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update geo-routing rule' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ruleId = Number(id);
    if (Number.isNaN(ruleId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid rule ID' },
        { status: 400 },
      );
    }

    // In production: await prisma.geoRoutingRule.delete({ where: { id: ruleId } })
    return NextResponse.json(
      { success: false, error: 'In-memory store does not support DELETE. Use database model.' },
      { status: 501 },
    );
  } catch (err) {
    console.error('[api/routing/geo/[id]] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete geo-routing rule' },
      { status: 500 },
    );
  }
}

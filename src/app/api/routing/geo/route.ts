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

const createGeoRuleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  target: geoTargetSchema,
  action: z.enum(['ALLOW', 'BLOCK', 'ROUTE']),
  chainId: z.number().int().positive().optional(),
  priority: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

// In-memory store for geo-routing rules (replace with DB model in production)
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

let nextId = 1;

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      data: geoRules.sort((a, b) => a.priority - b.priority),
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
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const rule = {
      id: nextId++,
      ...parsed.data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    geoRules.push(rule);

    return NextResponse.json(
      { success: true, data: rule },
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

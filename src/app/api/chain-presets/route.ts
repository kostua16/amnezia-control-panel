import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getChainPresets,
  createChainPreset,
} from '@/lib/chain-presets';

const createSchema = z.object({
  name: z.string().min(1, 'Name is required').max(128, 'Name must be at most 128 characters'),
  description: z.string().max(500).optional(),
  topology: z.enum(['linear', 'split', 'mesh']).optional(),
  nodeCount: z.number().int().min(1).max(10).optional(),
  chainTemplateId: z.string().max(64).optional(),
  routingBundleId: z.string().max(64).nullable().optional(),
  protocolOverrides: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function GET() {
  try {
    const presets = await getChainPresets();

    return NextResponse.json({ success: true, data: presets });
  } catch (err) {
    console.error('[api/chain-presets] GET error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch chain presets' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const preset = await createChainPreset({
      name: parsed.data.name,
      description: parsed.data.description,
      topology: parsed.data.topology,
      nodeCount: parsed.data.nodeCount,
      routingBundleId: parsed.data.routingBundleId ?? undefined,
    });

    return NextResponse.json({ success: true, data: preset }, { status: 201 });
  } catch (err) {
    console.error('[api/chain-presets] POST error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to create chain preset' },
      { status: 500 },
    );
  }
}

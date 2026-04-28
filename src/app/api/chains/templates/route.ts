import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTemplates } from '@/lib/chain-templates';

const listTemplatesSchema = z.object({
  topology: z.enum(['linear', 'split', 'mesh']).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const topology = searchParams.get('topology') ?? undefined;

    const parsed = listTemplatesSchema.safeParse({ topology });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid query parameters' },
        { status: 422 },
      );
    }

    const templates = getTemplates(parsed.data.topology);

    return NextResponse.json({
      success: true,
      data: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        topology: t.topology,
        requiredServers: t.requiredServers,
        nodes: t.nodes,
        icon: t.icon,
      })),
    });
  } catch (err) {
    console.error('[api/chains/templates] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch chain templates' },
      { status: 500 },
    );
  }
}

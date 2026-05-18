import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getChainPreset, deleteChainPreset } from '@/lib/chain-presets';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  try {
    const { id } = paramsSchema.parse(await params);

    const preset = await getChainPreset(id);

    if (!preset) {
      return NextResponse.json(
        { success: false, error: 'Chain preset not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: preset });
  } catch (err) {
    console.error('[api/chain-presets/:id] GET error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch chain preset' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  try {
    const { id } = paramsSchema.parse(await params);

    await deleteChainPreset(id);

    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    console.error('[api/chain-presets/:id] DELETE error:', err);

    const message =
      err instanceof Error ? err.message : 'Failed to delete chain preset';
    const status = message.includes('not found')
      ? 404
      : message.includes('Cannot delete built-in')
        ? 403
        : 500;

    return NextResponse.json({ success: false, error: message }, { status });
  }
}

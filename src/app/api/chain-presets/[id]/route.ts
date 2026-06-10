import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getChainPreset, deleteChainPreset } from '@/lib/chain-presets';
import { error, success } from '@/lib/api-response';

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
      return error('Chain preset not found', 404);
    }

    return success(preset);
  } catch (err) {
    console.error('[api/chain-presets/:id] GET error:', err);
    return error('Failed to fetch chain preset');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  try {
    const { id } = paramsSchema.parse(await params);

    await deleteChainPreset(id);

    return success(null);
  } catch (err) {
    console.error('[api/chain-presets/:id] DELETE error:', err);

    const message =
      err instanceof Error ? err.message : 'Failed to delete chain preset';
    const status = message.includes('not found')
      ? 404
      : message.includes('Cannot delete built-in')
        ? 403
        : 500;

    return error(message, status);
  }
}

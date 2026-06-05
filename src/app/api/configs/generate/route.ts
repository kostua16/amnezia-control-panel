import { NextRequest } from 'next/server';
import { z } from 'zod';
import { generateConfig } from '@/lib/config-generator';
import { error, success, validationError } from '@/lib/api-response';

const generateConfigSchema = z.object({
  templateId: z.number().int().positive('Template ID is required'),
  userId: z.number().int().positive().optional(),
  serverId: z.number().int().positive().optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = generateConfigSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { templateId, userId, serverId, overrides } = parsed.data;

    const config = await generateConfig(templateId, {
      userId,
      serverId,
      overrides,
    });

    return success(config, undefined, 201);
  } catch (err) {
    console.error('[api/configs/generate] POST error:', err);

    const message =
      err instanceof Error ? err.message : 'Failed to generate configuration';

    const status = message.includes('not found') ? 404 : 500;

    return error(message, status);
  }
}

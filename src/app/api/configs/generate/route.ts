import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateConfig } from '@/lib/config-generator';

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
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { templateId, userId, serverId, overrides } = parsed.data;

    const config = await generateConfig(templateId, {
      userId,
      serverId,
      overrides,
    });

    return NextResponse.json({ success: true, data: config }, { status: 201 });
  } catch (err) {
    console.error('[api/configs/generate] POST error:', err);

    const message =
      err instanceof Error ? err.message : 'Failed to generate configuration';

    const status = message.includes('not found') ? 404 : 500;

    return NextResponse.json({ success: false, error: message }, { status });
  }
}

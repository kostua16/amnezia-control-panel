import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPresets, applyPreset, getPreset } from '@/lib/config-presets';

const applyPresetSchema = z.object({
  presetName: z.string().min(1, 'Preset name is required'),
  baseConfig: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function GET() {
  try {
    const presets = getPresets();

    return NextResponse.json({
      success: true,
      data: presets,
    });
  } catch (err) {
    console.error('[api/configs/presets] GET error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch presets' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = applyPresetSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { presetName, baseConfig } = parsed.data;
    const preset = getPreset(presetName);

    if (!preset) {
      return NextResponse.json(
        { success: false, error: `Preset not found: ${presetName}` },
        { status: 404 },
      );
    }

    const result = applyPreset(presetName, baseConfig);

    return NextResponse.json({
      success: true,
      data: {
        preset: preset.name,
        label: preset.label,
        serviceType: preset.serviceType,
        protocol: preset.protocol,
        config: result,
      },
    });
  } catch (err) {
    console.error('[api/configs/presets] POST error:', err);

    const message =
      err instanceof Error ? err.message : 'Failed to apply preset';

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getChainPreset } from '@/lib/chain-presets';
import { applyTemplateRules } from '@/lib/routing-rule-templates';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function POST(
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

    if (!preset.routingBundleId) {
      return NextResponse.json({
        success: true,
        data: {
          presetName: preset.name,
          created: 0,
          skipped: 0,
          message: 'No routing bundle associated with this preset',
        },
      });
    }

    const routingTemplate = await prisma.routingRuleTemplate.findFirst({
      where: { name: preset.routingBundleId },
    });

    if (!routingTemplate) {
      return NextResponse.json({
        success: true,
        data: {
          presetName: preset.name,
          created: 0,
          skipped: 0,
          errors: [`Routing bundle "${preset.routingBundleId}" not found in templates`],
        },
      });
    }

    const result = await applyTemplateRules(routingTemplate.id);

    return NextResponse.json({
      success: true,
      data: {
        presetName: preset.name,
        created: result.created,
        skipped: result.skipped,
        errors: result.errors,
      },
    });
  } catch (err) {
    console.error('[api/chain-presets/apply] POST error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to apply chain preset' },
      { status: 500 },
    );
  }
}

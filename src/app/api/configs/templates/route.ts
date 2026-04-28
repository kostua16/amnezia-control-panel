import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getTemplates,
  createTemplate,
} from '@/lib/config-templates';

const serviceTypeEnum = z.enum(['AWG', 'THREE_XUI']).optional();

const createTemplateSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(128, 'Name must be at most 128 characters'),
  serviceType: z.enum(['AWG', 'THREE_XUI']).optional(),
  protocol: z
    .string()
    .min(1, 'Protocol is required')
    .max(64, 'Protocol must be at most 64 characters'),
  content: z.record(z.string(), z.unknown()).default({}),
  description: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serviceType = searchParams.get('serviceType');

    const parsed = serviceTypeEnum.safeParse(
      serviceType ?? undefined,
    );

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid serviceType parameter' },
        { status: 422 },
      );
    }

    const templates = await getTemplates(parsed.data);

    return NextResponse.json({
      success: true,
      data: templates,
    });
  } catch (err) {
    console.error('[api/configs/templates] GET error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch templates' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createTemplateSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const template = await createTemplate(parsed.data);

    return NextResponse.json(
      { success: true, data: template },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/configs/templates] POST error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to create template' },
      { status: 500 },
    );
  }
}

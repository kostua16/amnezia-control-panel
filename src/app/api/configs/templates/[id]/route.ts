import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getTemplate,
  updateTemplate,
  deleteTemplate,
} from '@/lib/config-templates';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  serviceType: z.enum(['AWG', 'THREE_XUI']).optional(),
  protocol: z.string().min(1).max(64).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  try {
    const { id } = paramsSchema.parse(await params);

    const template = await getTemplate(id);

    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: template });
  } catch (err) {
    console.error('[api/configs/templates/:id] GET error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch template' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  try {
    const { id } = paramsSchema.parse(await params);
    const body = await request.json();
    const parsed = updateTemplateSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const template = await updateTemplate(id, parsed.data);

    return NextResponse.json({ success: true, data: template });
  } catch (err) {
    console.error('[api/configs/templates/:id] PATCH error:', err);

    const message =
      err instanceof Error ? err.message : 'Failed to update template';
    const status = message.includes('not found') ? 404 : 500;

    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  try {
    const { id } = paramsSchema.parse(await params);

    await deleteTemplate(id);

    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    console.error('[api/configs/templates/:id] DELETE error:', err);

    const message =
      err instanceof Error ? err.message : 'Failed to delete template';
    const status = message.includes('not found')
      ? 404
      : message.includes('Cannot delete')
        ? 403
        : 500;

    return NextResponse.json({ success: false, error: message }, { status });
  }
}

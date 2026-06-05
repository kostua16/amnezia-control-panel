import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getTemplate,
  updateTemplate,
  deleteTemplate,
} from '@/lib/config-templates';
import { error, success, validationError } from '@/lib/api-response';

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
      return error('Template not found', 404);
    }

    return success(template);
  } catch (err) {
    console.error('[api/configs/templates/:id] GET error:', err);
    return error('Failed to fetch template');
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
      return validationError(parsed.error);
    }

    const template = await updateTemplate(id, parsed.data);

    return success(template);
  } catch (err) {
    console.error('[api/configs/templates/:id] PATCH error:', err);

    const message =
      err instanceof Error ? err.message : 'Failed to update template';
    const status = message.includes('not found') ? 404 : 500;

    return error(message, status);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
) {
  try {
    const { id } = paramsSchema.parse(await params);

    await deleteTemplate(id);

    return success(null);
  } catch (err) {
    console.error('[api/configs/templates/:id] DELETE error:', err);

    const message =
      err instanceof Error ? err.message : 'Failed to delete template';
    const status = message.includes('not found')
      ? 404
      : message.includes('Cannot delete')
        ? 403
        : 500;

    return error(message, status);
  }
}

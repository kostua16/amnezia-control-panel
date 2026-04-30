import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applyTemplateRules } from '@/lib/routing-rule-templates';

// GET: Return single template by ID
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const templateId = parseInt(id, 10);
    if (isNaN(templateId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid template ID' },
        { status: 422 },
      );
    }

    const template = await prisma.routingRuleTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: template });
  } catch (err) {
    console.error('[api/routing/templates/:id GET] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch template' },
      { status: 500 },
    );
  }
}

// POST: Apply template rules to geo routing
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const templateId = parseInt(id, 10);
    if (isNaN(templateId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid template ID' },
        { status: 422 },
      );
    }

    const result = await applyTemplateRules(templateId);

    if (result.errors.length > 0 && result.created === 0 && result.skipped === 0) {
      return NextResponse.json(
        { success: false, error: result.errors[0] },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[api/routing/templates/:id POST] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to apply template' },
      { status: 500 },
    );
  }
}

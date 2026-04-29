import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const createPanelSchema = z.object({
  name: z
    .string()
    .min(1, 'Panel name is required')
    .max(100, 'Panel name must be at most 100 characters'),
  panelUrl: z
    .string()
    .min(1, 'Panel URL is required')
    .max(500, 'Panel URL must be at most 500 characters')
    .url('Invalid URL format'),
  apiKey: z.string().min(1, 'API key is required'),
});

export async function GET() {
  try {
    const panels = await prisma.remotePanel.findMany({
      orderBy: { createdAt: 'asc' },
    });

    const data = panels.map((panel) => ({
      id: panel.id,
      name: panel.name,
      panelUrl: panel.panelUrl,
      isActive: panel.isActive,
      createdAt: panel.createdAt.toISOString(),
      updatedAt: panel.updatedAt.toISOString(),
    }));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[api/panels] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch remote panels' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createPanelSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const { name, panelUrl, apiKey } = parsed.data;

    const bcrypt = await import('bcryptjs');
    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    const panel = await prisma.remotePanel.create({
      data: { name, panelUrl, apiKeyHash },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: panel.id,
          name: panel.name,
          panelUrl: panel.panelUrl,
          isActive: panel.isActive,
          createdAt: panel.createdAt.toISOString(),
          updatedAt: panel.updatedAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/panels POST] Error:', err);

    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { success: false, error: 'Panel URL already exists' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to create remote panel' },
      { status: 500 },
    );
  }
}

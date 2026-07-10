import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const updateWhitelistSchema = z.object({
  type: z.enum(['domain', 'ip', 'cidr']).optional(),
  value: z.string().min(1).max(500).optional(),
  description: z.string().max(200).optional(),
  serverId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const entryId = Number(id);
    if (Number.isNaN(entryId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid entry ID' },
        { status: 400 },
      );
    }

    const entry = await prisma.whitelistEntry.findUnique({
      where: { id: entryId },
    });

    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Entry not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: entry });
  } catch (err) {
    console.error('[api/routing/whitelist/[id]] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch whitelist entry' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const entryId = Number(id);
    if (Number.isNaN(entryId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid entry ID' },
        { status: 400 },
      );
    }

    const existing = await prisma.whitelistEntry.findUnique({
      where: { id: entryId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Entry not found' },
        { status: 404 },
      );
    }

    const body = await request.json();
    const parsed = updateWhitelistSchema.safeParse(body);

    if (!parsed.success) {
      const firstError =
        parsed.error.issues[0]?.message ?? 'Invalid request body';
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 422 },
      );
    }

    const entry = await prisma.whitelistEntry.update({
      where: { id: entryId },
      data: parsed.data,
    });

    return NextResponse.json({ success: true, data: entry });
  } catch (err) {
    console.error('[api/routing/whitelist/[id]] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update whitelist entry' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const entryId = Number(id);
    if (Number.isNaN(entryId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid entry ID' },
        { status: 400 },
      );
    }

    const existing = await prisma.whitelistEntry.findUnique({
      where: { id: entryId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Entry not found' },
        { status: 404 },
      );
    }

    await prisma.whitelistEntry.delete({
      where: { id: entryId },
    });

    return NextResponse.json({ success: true, data: existing });
  } catch (err) {
    console.error('[api/routing/whitelist/[id]] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete whitelist entry' },
      { status: 500 },
    );
  }
}

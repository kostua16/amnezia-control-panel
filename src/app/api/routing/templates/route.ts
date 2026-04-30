import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET: List all templates
export async function GET() {
  try {
    const templates = await prisma.routingRuleTemplate.findMany({
      orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
    });
    return NextResponse.json({ success: true, data: templates });
  } catch (err) {
    console.error('[api/routing/templates GET] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch templates' },
      { status: 500 },
    );
  }
}

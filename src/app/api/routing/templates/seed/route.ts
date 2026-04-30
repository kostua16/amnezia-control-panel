import { NextResponse } from 'next/server';
import { seedTemplates } from '@/lib/routing-rule-templates';

export async function POST() {
  try {
    const result = await seedTemplates();
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[api/routing/templates/seed POST] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to seed templates' },
      { status: 500 },
    );
  }
}

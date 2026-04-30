import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { importFromGeoIPDat } from '@/lib/routing-rule-templates';

const importSchema = z.object({
  overwrite: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' },
        { status: 422 },
      );
    }

    const result = await importFromGeoIPDat(parsed.data.overwrite);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[api/routing/import POST] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Import failed' },
      { status: 500 },
    );
  }
}

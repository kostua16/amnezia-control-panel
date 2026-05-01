import { NextResponse } from 'next/server';
import { seedChainPresets } from '@/lib/chain-presets';

export async function POST() {
  try {
    const result = await seedChainPresets();
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[api/chain-presets/seed] POST error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to seed chain presets' },
      { status: 500 },
    );
  }
}

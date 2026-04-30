import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { lookupGeoIP } from '@/lib/geoip-manager';

const lookupSchema = z.object({
  ip: z.string().min(1, 'IP address is required'),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ip = searchParams.get('ip');

    if (!ip) {
      return NextResponse.json(
        { success: false, error: 'Query parameter "ip" is required' },
        { status: 400 },
      );
    }

    const parsed = lookupSchema.safeParse({ ip });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || 'Invalid IP' },
        { status: 422 },
      );
    }

    const result = await lookupGeoIP(parsed.data.ip);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[api/routing/geoip-lookup] Error:', err);
    return NextResponse.json(
      { success: false, error: 'GeoIP lookup failed' },
      { status: 500 },
    );
  }
}

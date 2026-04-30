import { NextResponse } from 'next/server';
import { getGeoIPStatus } from '@/lib/geoip-manager';

export async function GET() {
  try {
    const status = getGeoIPStatus();
    return NextResponse.json({ success: true, data: status });
  } catch (err) {
    console.error('[api/geoip/status] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to get GeoIP status' },
      { status: 500 },
    );
  }
}

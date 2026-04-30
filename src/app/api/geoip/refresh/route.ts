import { NextResponse } from 'next/server';
import { refreshGeoIP } from '@/lib/geoip-manager';

export async function POST() {
  try {
    const result = await refreshGeoIP();
    if (result.success) {
      return NextResponse.json({ success: true, data: result });
    }
    return NextResponse.json({ success: false, error: result.message }, { status: 500 });
  } catch (err) {
    console.error('[api/geoip/refresh] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to refresh GeoIP database' },
      { status: 500 },
    );
  }
}

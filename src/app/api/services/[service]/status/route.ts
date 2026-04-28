import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';

const VALID_SERVICES = ['awg', '3x-ui'] as const;

const SYSTEMD_NAMES: Record<string, string> = {
  awg: 'amnezia-awg',
  '3x-ui': '3x-ui',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service } = await params;

  if (!VALID_SERVICES.includes(service as (typeof VALID_SERVICES)[number])) {
    return NextResponse.json(
      { success: false, error: `Invalid service: ${service}. Must be 'awg' or '3x-ui'` },
      { status: 400 },
    );
  }

  const systemdName = SYSTEMD_NAMES[service];

  try {
    const result = execFileSync('systemctl', ['is-active', systemdName], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    const isOnline = result === 'active';

    return NextResponse.json({
      service,
      status: isOnline ? 'online' : 'offline',
      timestamp: new Date().toISOString(),
    });
  } catch {
    // systemctl is-active returns non-zero exit code when service is inactive or not found
    return NextResponse.json({
      service,
      status: 'offline',
      timestamp: new Date().toISOString(),
    });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { checkServiceStatus, type ServiceKey } from '@/lib/service-monitor';

const VALID_SERVICES: readonly ServiceKey[] = ['awg', '3x-ui'];

function isServiceKey(value: string): value is ServiceKey {
  return (VALID_SERVICES as readonly string[]).includes(value);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ service: string }> },
) {
  const { service } = await params;

  if (!isServiceKey(service)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid service: ${service}. Must be 'awg' or '3x-ui'`,
      },
      { status: 400 },
    );
  }

  // Delegate to the shared async systemctl check so this HTTP handler does not
  // block the event loop while waiting for systemd to respond.
  const health = await checkServiceStatus(service);

  return NextResponse.json({
    service: health.service,
    status: health.status,
    timestamp: health.timestamp,
  });
}

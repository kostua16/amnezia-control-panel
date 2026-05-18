import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { exportAllConfigs, exportConfigsByService } from '@/lib/config-export';

const serviceTypeEnum = z.enum(['AWG', 'THREE_XUI']).optional();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serviceType = searchParams.get('serviceType');

    const parsed = serviceTypeEnum.safeParse(serviceType ?? undefined);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid serviceType parameter' },
        { status: 422 },
      );
    }

    const exportData = parsed.data
      ? await exportConfigsByService(parsed.data)
      : await exportAllConfigs();

    const timestamp = new Date().toISOString().slice(0, 10);
    const suffix = parsed.data ? `-${parsed.data.toLowerCase()}` : '';
    const filename = `amnezia-configs${suffix}-${timestamp}.json`;

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('[api/configs/export] GET error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to export configurations' },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';

interface ChainStatusNode {
  id: string;
  label: string;
  hostname: string;
  status: 'active' | 'degraded' | 'down';
  latencyMs: number | null;
}

interface ChainStatusConnection {
  fromNode: string;
  toNode: string;
  trafficBytesPerSec: number;
  latencyMs: number | null;
}

interface ChainStatusResponse {
  chainId: string;
  topology: 'linear' | 'split' | 'mesh';
  isActive: boolean;
  nodes: ChainStatusNode[];
  connections: ChainStatusConnection[];
  lastUpdatedAt: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // STUB: Return mock status data.
    // In production, query actual chain status from service health checks
    // and traffic monitoring data.
    const mockStatus: ChainStatusResponse = {
      chainId: id,
      topology: 'linear',
      isActive: true,
      nodes: [
        {
          id: 'node-0',
          label: 'Entry Server',
          hostname: 'vpn1.example.com',
          status: 'active',
          latencyMs: 12,
        },
        {
          id: 'node-1',
          label: 'Exit Server',
          hostname: 'vpn2.example.com',
          status: 'active',
          latencyMs: 45,
        },
      ],
      connections: [
        {
          fromNode: 'node-0',
          toNode: 'node-1',
          trafficBytesPerSec: 125_829, // ~123 KB/s
          latencyMs: 33,
        },
      ],
      lastUpdatedAt: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: mockStatus,
    });
  } catch (err) {
    console.error('[api/chains/[id]/status] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch chain status' },
      { status: 500 },
    );
  }
}

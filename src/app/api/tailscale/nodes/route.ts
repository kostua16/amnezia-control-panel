import { NextResponse } from 'next/server';
import { getNodes, getStatus } from '@/lib/tailscale';

/**
 * GET /api/tailscale/nodes
 *
 * Lists all nodes in the tailnet (self + peers).
 *
 * Note (Pitfall 5): All tailnet peers are returned including phones,
 * laptops, etc. The frontend is responsible for filtering to
 * relevant server nodes.
 *
 * Only fields from TailscaleNodeInfo are included in the response.
 * Sensitive fields (PublicKey, CurAddr, RxBytes, TxBytes, LastSeen,
 * AllowedIPs) are stripped by the tailscale utility (T-11.1-02, T-11.1-09).
 */
export async function GET() {
  try {
    const status = await getStatus();

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Tailscale is not running' },
        { status: 503 },
      );
    }

    const nodes = await getNodes();
    const selfNode = nodes.find((n) => n.isSelf) ?? null;
    const totalNodes = nodes.length;
    const onlineCount = nodes.filter((n) => n.online).length;

    return NextResponse.json({
      success: true,
      data: {
        nodes,
        selfNode,
        totalNodes,
        onlineCount,
        version: status.Version,
      },
    });
  } catch (err) {
    console.error('[api/tailscale/nodes] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch tailnet nodes' },
      { status: 500 },
    );
  }
}

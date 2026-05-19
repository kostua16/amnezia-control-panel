import { NextResponse } from 'next/server';
import { getStatus, getNodes, getNodeIP } from '@/lib/tailscale';

// ─── GET handler ───────────────────────────────────────

/**
 * Return the current Tailscale node status.
 * Per D-02: runs fresh every call, no caching.
 * Per T-11.1-06: only returns TailscaleNodeInfo fields (no PublicKey, CurAddr, LastSeen).
 */
export async function GET() {
  try {
    const status = await getStatus();

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Tailscale is not running or not installed' },
        { status: 503 },
      );
    }

    // getNodes() already normalizes to TailscaleNodeInfo (strips PublicKey per T-11.1-02)
    const nodes = await getNodes();
    const peers = nodes.filter((n) => !n.isSelf);

    const nodeIP = await getNodeIP();

    return NextResponse.json({
      success: true,
      data: {
        self: {
          hostname: status.Self?.HostName ?? '',
          dnsName: status.Self?.DNSName ?? '',
          ip: nodeIP ?? status.Self?.TailscaleIPs?.[0] ?? '',
          version: status.Version ?? '',
        },
        backendState: status.BackendState ?? 'Unknown',
        peerCount: peers.length,
        peers,
      },
    });
  } catch (err) {
    console.error('[api/tailscale/status] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve Tailscale status' },
      { status: 500 },
    );
  }
}

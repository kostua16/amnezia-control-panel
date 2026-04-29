import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getNodeIP, isReachable } from '@/lib/tailscale';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/servers/:id/tailnet
 *
 * Resolves the Tailscale transport address for a specific server.
 * Implements TSCL-04 with 3-tier fallback strategy (D-07):
 *   1. Use server.tailnetIP from DB
 *   2. Resolve via getNodeIP(server.tailnetHostname)
 *   3. Fallback via getNodeIP(server.hostname)
 *
 * Online status is derived from tailscale status (D-08), NOT from DB.
 * Resolved IPs are cached back to the Server record when not from DB.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const serverId = Number(id);

    if (Number.isNaN(serverId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid server ID' },
        { status: 422 },
      );
    }

    const server = await prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      return NextResponse.json(
        { success: false, error: 'Server not found' },
        { status: 404 },
      );
    }

    let resolvedIP: string | null = null;
    let hostnameUsed: string = '';
    let source: 'db' | 'cli-resolve' | 'fallback' = 'db';

    // Tier 1: Use tailnetIP from DB (D-07)
    if (server.tailnetIP) {
      resolvedIP = server.tailnetIP;
      hostnameUsed = server.tailnetHostname ?? server.hostname;
      source = 'db';
    }

    // Tier 2: Resolve via tailnetHostname
    if (!resolvedIP && server.tailnetHostname) {
      resolvedIP = await getNodeIP(server.tailnetHostname);
      if (resolvedIP) {
        hostnameUsed = server.tailnetHostname;
        source = 'cli-resolve';
      }
    }

    // Tier 3: Fallback via server hostname
    if (!resolvedIP) {
      resolvedIP = await getNodeIP(server.hostname);
      if (resolvedIP) {
        hostnameUsed = server.hostname;
        source = 'fallback';
      }
    }

    // All tiers failed
    if (!resolvedIP) {
      return NextResponse.json(
        { success: false, error: 'Cannot resolve Tailscale IP for this server' },
        { status: 404 },
      );
    }

    // D-08: Online status from tailscale status, NOT from DB
    const reachabilityHostname = server.tailnetHostname ?? server.hostname;
    const online = await isReachable(reachabilityHostname);

    // Cache resolved IP back to Server record if not from DB
    if (source !== 'db') {
      await prisma.server.update({
        where: { id: serverId },
        data: {
          tailnetIP: resolvedIP,
          tailnetHostname: hostnameUsed,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        transportAddress: {
          tailscaleIP: resolvedIP,
          hostname: hostnameUsed || `${server.hostname}`,
          port: 443,
        },
        online,
        source,
      },
    });
  } catch (err) {
    console.error('[api/servers/:id/tailnet] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to resolve Tailscale transport address' },
      { status: 500 },
    );
  }
}

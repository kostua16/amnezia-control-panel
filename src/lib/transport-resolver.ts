import { getNodeIP, isReachable } from './tailscale';

// ─── Types ───────────────────────────────────────────────

/**
 * Result of resolving a panel's transport address.
 * Used by chain-router, config-applier, and panel-sync-client
 * to obtain a canonical Tailscale URL for reaching remote panels.
 */
export interface ResolvedTransport {
  /** Canonical URL for reaching the remote panel: https://<tailscaleIP>:<port> */
  panelUrl: string;
  /** The Tailscale IPv4 address used */
  tailscaleIP: string;
  /** The hostname that resolved to the IP */
  hostname: string;
  /** The port used for the panel URL */
  port: number;
  /** Whether the node is online per tailscale status */
  online: boolean;
  /** Which resolution tier succeeded */
  source: 'db' | 'cli-resolve' | 'fallback' | 'panel-url-direct';
}

// ─── Exported Function ──────────────────────────────────

/**
 * Resolve the transport address for a remote panel using a 3-tier
 * fallback strategy extracted from /api/servers/:id/tailnet:
 *
 *   Tier 1 (DB cache):   server.tailnetIP from the database
 *   Tier 2 (CLI tailnet): getNodeIP(server.tailnetHostname) via Tailscale CLI
 *   Tier 3 (CLI fallback): getNodeIP(server.hostname) via Tailscale CLI
 *
 * On success, the resolved IP is cached back to the Server record
 * when it was not already present in the DB (Tier 2/3).
 *
 * Non-throwing: returns null when all tiers fail or on unexpected errors.
 *
 * @param server  - Server record with tailnet fields (id, tailnetIP, tailnetHostname, hostname)
 * @param panel   - Panel record providing the fallback panelUrl
 * @param defaultPort - Port to use for the constructed panelUrl (default 443)
 */
export async function resolvePanelTransport(
  server: { id: number; tailnetIP?: string | null; tailnetHostname?: string | null; hostname: string },
  panel: { panelUrl: string },
  defaultPort = 443,
): Promise<ResolvedTransport | null> {
  try {
    let resolvedIP: string | null = null;
    let hostnameUsed = '';
    let source: ResolvedTransport['source'] = 'db';

    // ── Tier 1: DB cache ────────────────────────────────
    if (server.tailnetIP) {
      resolvedIP = server.tailnetIP;
      hostnameUsed = server.tailnetHostname ?? server.hostname;
      source = 'db';
    }

    // ── Tier 2: CLI resolution via tailnetHostname ──────
    if (!resolvedIP && server.tailnetHostname) {
      resolvedIP = await getNodeIP(server.tailnetHostname);
      if (resolvedIP) {
        hostnameUsed = server.tailnetHostname;
        source = 'cli-resolve';
      }
    }

    // ── Tier 3: CLI resolution via server hostname ──────
    if (!resolvedIP) {
      resolvedIP = await getNodeIP(server.hostname);
      if (resolvedIP) {
        hostnameUsed = server.hostname;
        source = 'fallback';
      }
    }

    // All tiers failed
    if (!resolvedIP) {
      console.error(
        '[transport-resolver] All tiers failed for server %d (%s). No Tailscale IP resolved.',
        server.id,
        server.hostname,
      );
      return null;
    }

    // ── Cache-back: persist resolved IP to DB ───────────
    if (source !== 'db') {
      try {
        const { prisma } = await import('./prisma');
        await prisma.server.update({
          where: { id: server.id },
          data: {
            tailnetIP: resolvedIP,
            tailnetHostname: hostnameUsed,
          },
        });
      } catch (cacheErr) {
        console.error(
          '[transport-resolver] Failed to cache resolved IP to DB for server %d:',
          server.id,
          cacheErr,
        );
        // Non-fatal: resolution succeeded, caching is best-effort
      }
    }

    // ── Online check ────────────────────────────────────
    const online = await isReachable(hostnameUsed);

    // ── Construct panelUrl ──────────────────────────────
    const panelUrl = new URL(`https://${resolvedIP}:${defaultPort}`).toString();

    return {
      panelUrl,
      tailscaleIP: resolvedIP,
      hostname: hostnameUsed,
      port: defaultPort,
      online,
      source,
    };
  } catch (err) {
    console.error(
      '[transport-resolver] Unexpected error resolving transport for server %d:',
      server.id,
      err,
    );
    return null;
  }
}

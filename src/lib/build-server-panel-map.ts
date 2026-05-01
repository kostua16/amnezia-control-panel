/**
 * Build a mapping from server ID to panel ID by matching Tailscale addresses.
 *
 * Strategy: A server "belongs to" a panel when the server's tailnet IP or
 * tailnet hostname matches the panel's URL hostname (or its Tailscale network
 * includes that server).
 *
 * Falls back to exact hostname match between server.tailnetHostname and
 * the panelUrl's hostname (stripped of protocol and port).
 *
 * Unmatched servers are omitted from the map -- ChainFlowEditor treats them
 * as "unassigned" (rendered with a dashed yellow ring).
 */

interface ServerInfo {
  id: number;
  tailnetIP?: string | null;
  tailnetHostname?: string | null;
  hostname: string;
}

interface PanelInfo {
  id: number;
  panelUrl: string;
}

/**
 * Extract hostname from a URL string (strip protocol, port, path).
 */
function extractHostname(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    // Fallback: strip protocol and port manually
    return url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  }
}

/**
 * Build a Record<serverId, panelId> by matching server Tailscale addresses
 * against panel URL hostnames.
 */
export function buildServerPanelMap(
  servers: ServerInfo[],
  panels: PanelInfo[],
): Record<number, number> {
  const map: Record<number, number> = {};

  if (panels.length === 0 || servers.length === 0) {
    return map;
  }

  // Build panel hostname -> panelId lookup
  const panelHostLookup = new Map<string, number>();
  for (const panel of panels) {
    const host = extractHostname(panel.panelUrl);
    if (host) {
      panelHostLookup.set(host, panel.id);
    }
  }

  for (const server of servers) {
    // Try tailnetIP first
    if (server.tailnetIP) {
      const panelId = panelHostLookup.get(server.tailnetIP);
      if (panelId !== undefined) {
        map[server.id] = panelId;
        continue;
      }
    }

    // Try tailnetHostname
    if (server.tailnetHostname) {
      const panelId = panelHostLookup.get(server.tailnetHostname);
      if (panelId !== undefined) {
        map[server.id] = panelId;
        continue;
      }
    }

    // Try regular hostname as fallback
    const panelId = panelHostLookup.get(server.hostname);
    if (panelId !== undefined) {
      map[server.id] = panelId;
    }
  }

  return map;
}

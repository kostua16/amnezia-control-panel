import type {
  ChainTemplate,
  ChainConfig,
  ChainNode,
  WireGuardPeerConfig,
  XrayRoutingRule,
} from '@/types/chain';
import type { Server } from '@/types/server';
import type { GeoRoutingResult } from '@/types/geo-routing';
import type { ServiceType } from '@/generated/prisma/enums';
import { getTemplateById } from './chain-templates';
import { generatePerPanelConfig } from './panel-sync-client';
import { applyPanelConfig } from './config-applier';
import { resolveGeoRoute } from './geo-routing';
import { resolvePanelTransport } from './transport-resolver';

// ─── Types ───────────────────────────────────────────────

export interface ChainApplyResult {
  success: boolean;
  appliedTo: string[];
  errors: string[];
  geoRouting?: {
    sourceIp: string;
    result: GeoRoutingResult;
  };
}

// ─── Test support: injectable WireGuard service-port lookup ──

/**
 * Minimal Prisma surface needed to resolve the AWG (WireGuard) service port
 * for a server. Narrow on purpose so tests can inject a tiny mock instead of
 * standing up a full database client, while production uses the real client.
 */
export type ChainRouterServicePortLookup = {
  service: {
    findFirst: (args: {
      where: { serverId: number; type: ServiceType };
      select: { port: true };
    }) => Promise<{ port: number | null } | null>;
  };
};

/**
 * Test-injected override for the WireGuard service-port lookup. When set,
 * generateChainConfig uses this instead of dynamically importing Prisma, so
 * port resolution is testable without a live database. Cleared by __resetDeps.
 */
let _prismaOverride: ChainRouterServicePortLookup | null = null;

/**
 * Generate a full chain configuration from a template and server selection.
 *
 * Resolves template node placeholders with actual server info,
 * generates WireGuard peer configs for chain links, and creates
 * Xray routing rules for chain direction.
 */
export async function generateChainConfig(
  templateId: string,
  servers: Server[],
  serverMapping: Record<number, number>,
): Promise<ChainConfig> {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  // Validate server mapping
  const mappedServerIds = Object.values(serverMapping);
  const uniqueMappedIds = new Set(mappedServerIds);

  if (uniqueMappedIds.size !== mappedServerIds.length) {
    throw new Error('Server mapping contains duplicate server assignments');
  }

  const availableServerIds = new Set(servers.map((s) => s.id));
  for (const serverId of mappedServerIds) {
    if (!availableServerIds.has(serverId)) {
      throw new Error(`Server ID ${serverId} not found in available servers`);
    }
  }

  // Build server lookup
  const serverLookup = new Map<number, Server>();
  for (const s of servers) {
    serverLookup.set(s.id, s);
  }

  // Resolve transport for each server in the chain.
  // Prefer the injected test override, otherwise load the real Prisma client.
  // Surface import failures instead of silently defaulting the WireGuard port
  // so a misconfigured database client is visible in production logs rather
  // than silently diverging to the 51820 default.
  let prisma: ChainRouterServicePortLookup | null = _prismaOverride;
  if (!prisma) {
    try {
      const mod = await import('./prisma');
      prisma = mod.prisma;
    } catch (err) {
      console.warn(
        `[chain-router] Prisma client unavailable; WireGuard service port lookup disabled (defaulting to 51820). Cause: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const resolvedNodes: Array<ChainNode & { hostname: string; port: number }> =
    await Promise.all(
      template.nodes.map(async (node, index) => {
        const serverId = serverMapping[index];
        if (serverId === undefined) {
          throw new Error(`No server mapping for node index ${index}`);
        }
        const server = serverLookup.get(serverId);
        if (!server) {
          throw new Error(
            `Server ${serverId} not found for node "${node.label}"`,
          );
        }

        // Resolve WireGuard service port from Service model
        // WireGuard typically uses port 51820; look up actual service port if available
        let wireguardPort = 51820;
        if (prisma) {
          try {
            const wireguardService = await prisma.service.findFirst({
              where: { serverId: server.id, type: 'AWG' },
              select: { port: true },
            });
            if (wireguardService?.port) {
              wireguardPort = wireguardService.port;
            }
          } catch {
            // Service lookup failed -- use default port
          }
        }

        // Resolve Tailscale transport address
        const transport = await resolvePanelTransport(
          server,
          {
            panelUrl: `https://${server.tailnetIP ?? server.hostname}:${wireguardPort}`,
          },
          wireguardPort,
        );

        if (transport) {
          return {
            ...node,
            serverId: server.id,
            hostname: transport.tailscaleIP,
            port: wireguardPort,
          };
        }

        // Fallback: use raw server data (with warning)
        console.warn(
          `[chain-router] Transport resolution failed for server ${server.id} (${server.hostname}), falling back to raw hostname:port`,
        );
        return {
          ...node,
          serverId: server.id,
          hostname: server.hostname,
          port: wireguardPort,
        };
      }),
    );

  // Generate WireGuard peer configurations based on topology
  const wireguardPeers = generateWireGuardPeers(template, resolvedNodes);

  // Generate Xray routing rules based on topology
  const xrayRules = generateXrayRoutingRules(template, resolvedNodes);

  return {
    templateId: template.id,
    nodes: resolvedNodes,
    wireguardPeers,
    xrayRoutingRules: xrayRules,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Apply a chain configuration to all servers in the chain.
 *
 * For each node in the chain, generates a per-panel config payload and
 * calls the real config applier to apply WireGuard peers and/or Xray
 * routing rules to the remote panel's services.
 *
 * If `sourceIp` is provided, evaluates geo-routing rules before applying.
 * - BLOCK: skips chain application and reports the block decision.
 * - ROUTE (with chainId): skips application and reports the geo-redirect.
 * - ALLOW or no match: proceeds with normal chain application.
 */
export async function applyChainConfig(
  chainConfig: ChainConfig,
  sourceIp?: string,
  panelCredentials?: Map<number, { panelUrl: string; apiKey: string }>,
): Promise<ChainApplyResult> {
  const appliedTo: string[] = [];
  const errors: string[] = [];

  // Geo-routing pre-check when source IP is provided
  if (sourceIp) {
    const geoResult = await resolveGeoRoute(sourceIp);

    if (geoResult.action === 'BLOCK') {
      return {
        success: false,
        appliedTo: [],
        errors: [
          `Geo-routing BLOCK for ${sourceIp}: matched rule "${geoResult.rule?.name ?? 'unknown'}"`,
        ],
        geoRouting: { sourceIp, result: geoResult },
      };
    }

    if (geoResult.action === 'ROUTE' && geoResult.chainId) {
      return {
        success: false,
        appliedTo: [],
        errors: [
          `Geo-routing redirect for ${sourceIp}: matched rule "${geoResult.rule?.name ?? 'unknown'}", ` +
            `routing to chain ${geoResult.chainId} instead`,
        ],
        geoRouting: { sourceIp, result: geoResult },
      };
    }
  }

  for (const node of chainConfig.nodes) {
    try {
      const panelConfig = generatePerPanelConfig(chainConfig, node.serverId);
      if (!panelConfig) {
        continue;
      }

      // Look up panel credentials by serverId
      const creds = panelCredentials?.get(node.serverId);
      if (!creds) {
        errors.push(
          `No panel credentials registered for server ${node.serverId} (node: ${node.label})`,
        );
        continue;
      }

      const panelLabel = `${node.label} (${node.hostname})`;

      const results = await applyPanelConfig(
        creds.panelUrl,
        node.label,
        creds.apiKey,
        panelConfig,
      );

      for (const result of results) {
        if (result.success) {
          appliedTo.push(panelLabel);
        } else if (result.error) {
          errors.push(`${panelLabel}: ${result.error.message}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to apply to ${node.label}: ${message}`);
    }
  }

  return {
    success: errors.length === 0,
    appliedTo,
    errors,
  };
}

// ─── WireGuard Peer Generation ────────────────────────────

function generateWireGuardPeers(
  template: ChainTemplate,
  nodes: Array<ChainNode & { hostname: string; port: number }>,
): WireGuardPeerConfig[] {
  const peers: WireGuardPeerConfig[] = [];

  switch (template.topology) {
    case 'linear': {
      // In a linear chain, each node connects to the next
      for (let i = 0; i < nodes.length - 1; i++) {
        const current = nodes[i];
        const next = nodes[i + 1];

        peers.push({
          nodeId: current.label,
          publicKey: `STUB_PUBKEY_${next.label.replace(/\s+/g, '_')}`,
          allowedIPs: '0.0.0.0/0',
          endpoint: `${next.hostname}:${next.port}`,
          persistentKeepalive: 25,
        });

        peers.push({
          nodeId: next.label,
          publicKey: `STUB_PUBKEY_${current.label.replace(/\s+/g, '_')}`,
          allowedIPs: `10.0.0.${i + 1}/32`,
          endpoint: `${current.hostname}:${current.port}`,
          persistentKeepalive: 25,
        });
      }
      break;
    }
    case 'split': {
      // Split routing: domestic is direct, foreign handles VPN traffic
      // Find domestic node for documentation purposes (not used in peer config)
      void nodes.find((n) => n.role === 'domestic');
      const foreign = nodes.find((n) => n.role === 'foreign');

      if (foreign) {
        peers.push({
          nodeId: foreign.label,
          publicKey: `STUB_PUBKEY_${foreign.label.replace(/\s+/g, '_')}`,
          allowedIPs: '0.0.0.0/0',
          endpoint: `${foreign.hostname}:${foreign.port}`,
          persistentKeepalive: 25,
        });
      }
      // Domestic server doesn't need a WireGuard peer (direct connection)
      break;
    }
    case 'mesh': {
      // Mesh: every node connects to every other node
      for (let i = 0; i < nodes.length; i++) {
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const current = nodes[i];
          const peer = nodes[j];

          peers.push({
            nodeId: current.label,
            publicKey: `STUB_PUBKEY_${peer.label.replace(/\s+/g, '_')}`,
            allowedIPs: `10.0.0.${j + 1}/32`,
            endpoint: `${peer.hostname}:${peer.port}`,
            persistentKeepalive: 25,
          });
        }
      }
      break;
    }
  }

  return peers;
}

// ─── Xray Routing Rule Generation ────────────────────────

function generateXrayRoutingRules(
  template: ChainTemplate,
  nodes: Array<ChainNode & { hostname: string; port: number }>,
): XrayRoutingRule[] {
  const rules: XrayRoutingRule[] = [];

  switch (template.topology) {
    case 'linear': {
      // Route all traffic from entry to exit, then to direct
      const entry = nodes.find((n) => n.role === 'entry');
      const exit = nodes.find((n) => n.role === 'exit');

      if (entry && exit) {
        rules.push({
          nodeId: entry.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: `chain_${exit.label.replace(/\s+/g, '_')}`,
          priority: 0,
        });

        rules.push({
          nodeId: exit.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: 'direct',
          priority: 0,
        });
      }
      break;
    }
    case 'split': {
      // Split: domestic routes to direct, foreign routes through chain
      const domestic = nodes.find((n) => n.role === 'domestic');
      const foreign = nodes.find((n) => n.role === 'foreign');

      if (domestic) {
        rules.push({
          nodeId: domestic.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: 'direct',
          priority: 0,
        });
      }

      if (foreign) {
        rules.push({
          nodeId: foreign.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: 'direct',
          priority: 0,
        });
      }
      break;
    }
    case 'mesh': {
      // Mesh: all nodes route to direct
      for (const node of nodes) {
        rules.push({
          nodeId: node.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: 'direct',
          priority: 0,
        });
      }
      break;
    }
  }

  return rules;
}

// ─── Test Helpers ────────────────────────────────────────

/**
 * Inject test dependencies.
 *
 * `getNodeIP` and `isReachable` configure Tailscale transport resolution and
 * are implemented in transport-resolver (import its own __setDeps directly).
 * `prisma` overrides the WireGuard service-port lookup used by
 * generateChainConfig, so per-server port resolution can be exercised without
 * a live database — previously this path fell through to an opaque default.
 */
export function __setDeps(deps: {
  getNodeIP: (hostname?: string) => Promise<string | null>;
  isReachable: (hostname: string) => Promise<boolean>;
  prisma?: ChainRouterServicePortLookup | null;
}): void {
  void deps.getNodeIP;
  void deps.isReachable;
  if (deps.prisma !== undefined) {
    _prismaOverride = deps.prisma;
  }
}

/**
 * Reset injected test dependencies. Exported for test cleanup.
 */
export function __resetDeps(): void {
  _prismaOverride = null;
}

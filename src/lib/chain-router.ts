import type {
  ChainTemplate,
  ChainConfig,
  ChainNode,
  WireGuardPeerConfig,
  XrayRoutingRule,
} from '@/types/chain';
import type { Server } from '@/types/server';
import type { GeoRoutingResult } from '@/types/geo-routing';
import { getTemplateById } from './chain-templates';
import { generatePerPanelConfig } from './panel-sync-client';
import { applyPanelConfig } from './config-applier';
import { resolveGeoRoute } from './geo-routing';

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

/**
 * Generate a full chain configuration from a template and server selection.
 *
 * Resolves template node placeholders with actual server info,
 * generates WireGuard peer configs for chain links, and creates
 * Xray routing rules for chain direction.
 */
export function generateChainConfig(
  templateId: string,
  servers: Server[],
  serverMapping: Record<number, number>,
): ChainConfig {
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

  // Resolve nodes with actual server info
  const resolvedNodes: Array<ChainNode & { hostname: string; port: number }> =
    template.nodes.map((node, index) => {
      const serverId = serverMapping[index];
      if (serverId === undefined) {
        throw new Error(`No server mapping for node index ${index}`);
      }
      const server = serverLookup.get(serverId);
      if (!server) {
        throw new Error(`Server ${serverId} not found for node "${node.label}"`);
      }
      return {
        ...node,
        serverId: server.id,
        hostname: server.hostname,
        port: server.port,
      };
    });

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
        errors: [`Geo-routing BLOCK for ${sourceIp}: matched rule "${geoResult.rule?.name ?? 'unknown'}"`],
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
        errors.push(`No panel credentials registered for server ${node.serverId} (node: ${node.label})`);
        continue;
      }

      const panelLabel = `${node.label} (${node.hostname})`;

      const results = await applyPanelConfig(creds.panelUrl, node.label, creds.apiKey, panelConfig);

      for (const result of results) {
        if (result.success) {
          appliedTo.push(panelLabel);
        } else if (result.error) {
          errors.push(`${panelLabel}: ${result.error.message}`);
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
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
      const domestic = nodes.find((n) => n.role === 'domestic');
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

// ─── Xray Routing Rule Generation ─────────────────────────

function generateXrayRoutingRules(
  template: ChainTemplate,
  nodes: Array<ChainNode & { hostname: string; port: number }>,
): XrayRoutingRule[] {
  const rules: XrayRoutingRule[] = [];

  switch (template.topology) {
    case 'linear': {
      // Entry node routes all traffic to the next hop
      for (let i = 0; i < nodes.length - 1; i++) {
        const current = nodes[i];
        const next = nodes[i + 1];

        rules.push({
          nodeId: current.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: `chain_${next.label.replace(/\s+/g, '_')}`,
          priority: i * 10,
        });

        // Allow local traffic to bypass chain
        rules.push({
          nodeId: current.label,
          type: 'ip',
          value: '10.0.0.0/8',
          outboundTag: 'direct',
          priority: (i * 10) + 1,
        });
      }

      // Exit node routes directly
      const exitNode = nodes[nodes.length - 1];
      rules.push({
        nodeId: exitNode.label,
        type: 'ip',
        value: '0.0.0.0/0',
        outboundTag: 'direct',
        priority: (nodes.length - 1) * 10,
      });
      break;
    }
    case 'split': {
      // Split routing: domestic vs foreign
      const domestic = nodes.find((n) => n.role === 'domestic');
      const foreign = nodes.find((n) => n.role === 'foreign');

      if (domestic && foreign) {
        // Route domestic IPs directly
        rules.push({
          nodeId: domestic.label,
          type: 'geoip',
          value: 'ru', // Russia domestic traffic
          outboundTag: 'direct',
          priority: 0,
        });

        // Route foreign traffic through VPN
        rules.push({
          nodeId: domestic.label,
          type: 'geoip',
          value: 'private',
          outboundTag: 'direct',
          priority: 1,
        });

        rules.push({
          nodeId: domestic.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: `chain_${foreign.label.replace(/\s+/g, '_')}`,
          priority: 10,
        });

        // Foreign server routes everything directly
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
      // Mesh: routing rules for redundancy
      for (const node of nodes) {
        rules.push({
          nodeId: node.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: 'mesh_balancer',
          priority: 0,
        });

        // Direct for mesh-internal traffic
        rules.push({
          nodeId: node.label,
          type: 'ip',
          value: '10.0.0.0/8',
          outboundTag: 'direct',
          priority: 1,
        });
      }
      break;
    }
  }

  return rules;
}

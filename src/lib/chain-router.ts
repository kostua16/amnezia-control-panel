import type {
  ChainTemplate,
  ChainConfig,
  ChainNode,
  WireGuardPeerConfig,
  XrayRoutingRule,
} from '@/types/chain';
import type { Server } from '@/types/server';
import { getTemplateById } from './chain-templates';

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
 * NOTE: Currently a stub. In production, this would:
 * 1. SSH into each server
 * 2. Add WireGuard peer configs
 * 3. Update Xray routing rules
 * 4. Restart affected services
 */
export async function applyChainConfig(
  chainConfig: ChainConfig,
): Promise<{ success: boolean; appliedTo: string[]; errors: string[] }> {
  const appliedTo: string[] = [];
  const errors: string[] = [];

  for (const node of chainConfig.nodes) {
    try {
      // STUB: In production, use executeOnServer to apply configs
      console.log(
        `[chain-router] Would apply config to ${node.label} (${node.hostname}:${node.port})`,
      );

      // Collect WireGuard peer configs for this node
      const peers = chainConfig.wireguardPeers.filter(
        (p) => p.nodeId === node.label,
      );
      if (peers.length > 0) {
        console.log(
          `[chain-router] Would add ${peers.length} WireGuard peers to ${node.label}`,
        );
      }

      // Collect Xray rules for this node
      const rules = chainConfig.xrayRoutingRules.filter(
        (r) => r.nodeId === node.label,
      );
      if (rules.length > 0) {
        console.log(
          `[chain-router] Would add ${rules.length} Xray routing rules to ${node.label}`,
        );
      }

      appliedTo.push(`${node.label} (${node.hostname})`);
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

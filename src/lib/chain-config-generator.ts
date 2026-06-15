import type {
  ChainTemplate,
  ChainNode,
  WireGuardPeerConfig,
  XrayRoutingRule,
} from '@/types/chain';

/**
 * Resolved chain node: the template node plus the transport endpoint that was
 * resolved for it. Both chain generation call sites (the live apply path in
 * chain-router and the push-wizard preview path) produce nodes of this shape,
 * so the generators below are shared between them to keep preview and apply
 * output identical.
 */
export type ResolvedChainNode = ChainNode & { hostname: string; port: number };

/**
 * Generate WireGuard peer configurations for a chain topology.
 *
 * Peers use placeholder public keys (`STUB_PUBKEY_*`) — real keys are injected
 * at apply time. Shared by the chain apply path and the push-wizard preview so
 * both paths emit identical peer sets.
 */
export function generateWireGuardPeers(
  template: ChainTemplate,
  nodes: ResolvedChainNode[],
): WireGuardPeerConfig[] {
  const peers: WireGuardPeerConfig[] = [];

  switch (template.topology) {
    case 'linear': {
      // Each hop connects bidirectionally to the next node.
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
      // Only the foreign (VPN) node needs a WireGuard peer; the domestic node
      // reaches the client directly. Identified by role, which both call sites
      // populate from the template definition.
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
      break;
    }
    case 'mesh': {
      // Fully meshed: every node peers with every other node.
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
    default:
      throw new Error(`Unsupported topology: ${template.topology}`);
  }

  return peers;
}

/**
 * Generate Xray routing rules for a chain topology.
 *
 * Canonical behavior (resolves prior drift between the apply and preview paths):
 * - linear: per-hop rules with ascending priorities, plus a direct rule for
 *   inter-node (10.0.0.0/8) traffic and a catch-all direct rule on the exit.
 * - split: the domestic node routes RU/private geoip traffic direct and sends
 *   the remainder through the foreign chain; the foreign node exits direct.
 * - mesh: each node balances outbound traffic via the mesh balancer while
 *   keeping inter-node traffic direct.
 */
export function generateXrayRoutingRules(
  template: ChainTemplate,
  nodes: ResolvedChainNode[],
): XrayRoutingRule[] {
  const rules: XrayRoutingRule[] = [];

  switch (template.topology) {
    case 'linear': {
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

        rules.push({
          nodeId: current.label,
          type: 'ip',
          value: '10.0.0.0/8',
          outboundTag: 'direct',
          priority: i * 10 + 1,
        });
      }

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
      const domestic = nodes.find((n) => n.role === 'domestic');
      const foreign = nodes.find((n) => n.role === 'foreign');

      if (domestic && foreign) {
        // Domestic node: keep RU and private traffic direct, chain the rest.
        rules.push({
          nodeId: domestic.label,
          type: 'geoip',
          value: 'ru',
          outboundTag: 'direct',
          priority: 0,
        });
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

        // Foreign node: traffic exits directly to the internet.
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
      for (const node of nodes) {
        rules.push({
          nodeId: node.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: 'mesh_balancer',
          priority: 0,
        });
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
    default:
      throw new Error(`Unsupported topology: ${template.topology}`);
  }

  return rules;
}

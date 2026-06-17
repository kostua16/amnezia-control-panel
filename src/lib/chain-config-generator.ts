import type {
  ChainTemplate,
  ChainNode,
  ChainRoutingOptions,
  WireGuardPeerConfig,
  XrayRoutingRule,
} from '@/types/chain';
import { normalizeDirectGeoipTagsInput } from './chain-routing-options';
import { generateKeypair } from './wireguard-keys';

/**
 * Resolved chain node: the template node plus the transport endpoint that was
 * resolved for it. Both chain generation call sites (the live apply path in
 * chain-router and the push-wizard preview path) produce nodes of this shape,
 * so the generators below are shared between them to keep preview and apply
 * output identical.
 */
export type ResolvedChainNode = ChainNode & { hostname: string; port: number };

export function normalizeChainRoutingOptions(
  template: ChainTemplate,
  options?: ChainRoutingOptions,
): ChainRoutingOptions | undefined {
  if (template.topology !== 'split') {
    return undefined;
  }

  const tags = options?.split?.directGeoipTags ?? [];
  const { validTags: directGeoipTags, invalidTags } =
    normalizeDirectGeoipTagsInput(tags);

  if (directGeoipTags.length === 0) {
    throw new Error(
      'Split routing requires at least one direct GeoIP zone tag',
    );
  }

  if (invalidTags.length > 0) {
    throw new Error(`Invalid split GeoIP zone tag: ${invalidTags[0]}`);
  }

  return { split: { directGeoipTags } };
}

/**
 * Generate WireGuard peer configurations for a chain topology.
 *
 * Each peer receives a unique Curve25519 keypair. The public key is embedded
 * in the peer config; the private key is included so the panel can configure
 * its local WireGuard interface. Shared by the chain apply path and the
 * push-wizard preview so both paths emit identical peer sets.
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

        const forward = generateKeypair();
        const reverse = generateKeypair();

        peers.push({
          nodeId: current.label,
          publicKey: forward.publicKey,
          privateKey: forward.privateKey,
          allowedIPs: '0.0.0.0/0',
          endpoint: `${next.hostname}:${next.port}`,
          persistentKeepalive: 25,
        });

        peers.push({
          nodeId: next.label,
          publicKey: reverse.publicKey,
          privateKey: reverse.privateKey,
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
        const keypair = generateKeypair();
        peers.push({
          nodeId: foreign.label,
          publicKey: keypair.publicKey,
          privateKey: keypair.privateKey,
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

          const keypair = generateKeypair();
          peers.push({
            nodeId: current.label,
            publicKey: keypair.publicKey,
            privateKey: keypair.privateKey,
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
 * - split: the domestic node routes configured/private geoip traffic direct
 *   and sends the remainder through the foreign chain; the foreign node exits direct.
 * - mesh: each node balances outbound traffic via the mesh balancer while
 *   keeping inter-node traffic direct.
 */
export function generateXrayRoutingRules(
  template: ChainTemplate,
  nodes: ResolvedChainNode[],
  options?: ChainRoutingOptions,
): XrayRoutingRule[] {
  const rules: XrayRoutingRule[] = [];
  const routingOptions = normalizeChainRoutingOptions(template, options);

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
        const directGeoipTags = routingOptions!.split!.directGeoipTags;

        for (const [index, tag] of directGeoipTags.entries()) {
          rules.push({
            nodeId: domestic.label,
            type: 'geoip',
            value: tag,
            outboundTag: 'direct',
            priority: index,
          });
        }
        rules.push({
          nodeId: domestic.label,
          type: 'geoip',
          value: 'private',
          outboundTag: 'direct',
          priority: directGeoipTags.length,
        });
        rules.push({
          nodeId: domestic.label,
          type: 'ip',
          value: '0.0.0.0/0',
          outboundTag: `chain_${foreign.label.replace(/\s+/g, '_')}`,
          priority: directGeoipTags.length + 10,
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

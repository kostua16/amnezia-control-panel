import type { ChainTemplate } from '@/types/chain';

/**
 * Built-in chain templates for VPN topologies.
 *
 * Each template defines nodes, their roles, and the topology structure.
 * Server IDs are set to 0 as placeholders -- resolved at apply time
 * via the server mapping provided by the user.
 */

export const BUILTIN_CHAIN_TEMPLATES: ChainTemplate[] = [
  {
    id: '2hop-linear',
    name: '2-Hop Chain',
    description:
      'Route all traffic through two servers: an entry server and an exit server. Provides basic multi-hop anonymity.',
    topology: 'linear',
    requiredServers: 2,
    icon: 'Shield',
    nodes: [
      {
        label: 'Entry Server',
        serverId: 0,
        role: 'entry',
        protocol: 'wireguard',
      },
      {
        label: 'Exit Server',
        serverId: 0,
        role: 'exit',
        protocol: 'wireguard',
      },
    ],
  },
  {
    id: '3hop-linear',
    name: '3-Hop Chain',
    description:
      'Route all traffic through three servers: entry, middle relay, and exit. Maximum anonymity at the cost of latency.',
    topology: 'linear',
    requiredServers: 3,
    icon: 'Globe',
    nodes: [
      {
        label: 'Entry Server',
        serverId: 0,
        role: 'entry',
        protocol: 'wireguard',
      },
      {
        label: 'Middle Server',
        serverId: 0,
        role: 'middle',
        protocol: 'wireguard',
      },
      {
        label: 'Exit Server',
        serverId: 0,
        role: 'exit',
        protocol: 'wireguard',
      },
    ],
  },
  {
    id: 'split-routing',
    name: 'Split Routing',
    description:
      'Route domestic traffic directly (bypass VPN) and foreign traffic through a VPN server. Optimizes speed for local services.',
    topology: 'split',
    requiredServers: 2,
    icon: 'RefreshCw',
    nodes: [
      {
        label: 'Domestic (Direct)',
        serverId: 0,
        role: 'domestic',
        protocol: 'wireguard',
      },
      {
        label: 'Foreign (VPN)',
        serverId: 0,
        role: 'foreign',
        protocol: 'xray',
      },
    ],
  },
  {
    id: 'mesh-redundant',
    name: 'Mesh Redundancy',
    description:
      'Connect all servers in a mesh topology with automatic failover. Traffic routes through the fastest available path.',
    topology: 'mesh',
    requiredServers: 3,
    icon: 'Shield',
    nodes: [
      {
        label: 'Server A',
        serverId: 0,
        role: 'entry',
        protocol: 'wireguard',
      },
      {
        label: 'Server B',
        serverId: 0,
        role: 'middle',
        protocol: 'wireguard',
      },
      {
        label: 'Server C',
        serverId: 0,
        role: 'exit',
        protocol: 'wireguard',
      },
    ],
  },
];

/**
 * Get a template by its ID.
 */
export function getTemplateById(templateId: string): ChainTemplate | undefined {
  return BUILTIN_CHAIN_TEMPLATES.find((t) => t.id === templateId);
}

/**
 * Get all templates, optionally filtered by topology type.
 */
export function getTemplates(topology?: string): ChainTemplate[] {
  if (!topology) return BUILTIN_CHAIN_TEMPLATES;
  return BUILTIN_CHAIN_TEMPLATES.filter((t) => t.topology === topology);
}

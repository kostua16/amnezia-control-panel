export type ChainTopology = 'linear' | 'split' | 'mesh';

export interface ChainNode {
  /** Human-readable node label, e.g. "Entry Server", "Exit Server" */
  label: string;
  /** Server ID reference (resolved at apply time) */
  serverId: number;
  /** Role in the chain topology */
  role: 'entry' | 'middle' | 'exit' | 'domestic' | 'foreign';
  /** Protocol used for this node */
  protocol: 'wireguard' | 'xray';
}

export interface ChainTemplate {
  /** Unique template identifier */
  id: string;
  /** Human-readable template name */
  name: string;
  /** Template description */
  description: string;
  /** Topology type */
  topology: ChainTopology;
  /** Number of servers required */
  requiredServers: number;
  /** Node definitions (with placeholder serverIds = 0) */
  nodes: ChainNode[];
  /** Icon name from lucide-react */
  icon: string;
}

export interface ChainConfig {
  /** The template this config is based on */
  templateId: string;
  routingOptions?: ChainRoutingOptions;
  /** Applied nodes with resolved server IDs */
  nodes: Array<ChainNode & { hostname: string; port: number }>;
  /** Generated WireGuard peer configurations */
  wireguardPeers: WireGuardPeerConfig[];
  /** Generated Xray routing rules */
  xrayRoutingRules: XrayRoutingRule[];
  /** Timestamp when config was generated */
  generatedAt: string;
}

export interface WireGuardPeerConfig {
  /** Which node this peer config belongs to */
  nodeId: string;
  /** Peer public key */
  publicKey: string;
  /** Private key for the local interface (panels configure their WG interface with this) */
  privateKey?: string;
  /** Allowed IPs for this peer */
  allowedIPs: string;
  /** Endpoint address (hostname:port) */
  endpoint: string;
  /** Persistent keepalive interval */
  persistentKeepalive?: number;
}

export interface XrayRoutingRule {
  /** Which node this rule applies to */
  nodeId: string;
  /** Rule type: ip, domain, or geoip */
  type: 'ip' | 'domain' | 'geoip';
  /** Rule value (CIDR, domain pattern, or geoip tag) */
  value: string;
  /** Outbound tag to route traffic through */
  outboundTag: string;
  /** Rule priority (lower = higher priority) */
  priority: number;
}

export interface ApplyChainRequest {
  /** Template ID to use */
  templateId: string;
  /** Map of template node index to server ID */
  serverMapping: Record<number, number>;
  routingOptions?: ChainRoutingOptions;
}

export interface ChainRoutingOptions {
  split?: {
    directGeoipTags: string[];
  };
}

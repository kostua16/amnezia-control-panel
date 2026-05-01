/** Role of a panel within the chain topology */
export type PanelRole = 'entry' | 'middle' | 'exit' | 'domestic' | 'foreign';

/** A single node's config as relevant to a specific panel */
export interface PanelChainNode {
  label: string;
  serverId: number;
  role: PanelRole;
  protocol: 'wireguard' | 'xray';
  hostname: string;
  port: number;
}

/** A routing rule scoped to a panel */
export interface PanelRoutingRule {
  type: 'ip' | 'domain' | 'geoip';
  value: string;
  outboundTag: string;
  priority: number;
}

/** The config payload pushed from central to a single remote panel */
export interface PanelSyncPayload {
  /** Monotonically increasing version from central */
  configVersion: number;
  /** This panel's role in the chain */
  panelRole: PanelRole;
  /** Chain nodes relevant to this panel */
  chainNodes: PanelChainNode[];
  /** Routing rules for this panel */
  routingRules: PanelRoutingRule[];
  /** WireGuard peer configs relevant to this panel */
  wireguardPeers: Array<{
    publicKey: string;
    allowedIPs: string;
    endpoint: string;
    persistentKeepalive?: number;
  }>;
  /** ISO timestamp of generation */
  generatedAt: string;
}

/** Data payload inside a sync apply response */
export interface SyncApplyResponseData {
  applied: boolean;
  configVersion: number;
  service: string;
  message?: string;
  error?: string;
}

/** Response from POST /api/sync/apply */
export interface SyncApplyResponse {
  success: boolean;
  data: SyncApplyResponseData;
}

/** Data payload inside a sync receive response */
export interface SyncReceiveResponseData {
  applied: boolean;
  configVersion: number;
  message?: string;
}

/** Response from POST /api/sync/receive */
export interface SyncReceiveResponse {
  success: boolean;
  data: SyncReceiveResponseData;
}

/** Result of pushing config to a single panel */
export interface PushResult {
  panelId: number;
  panelName: string;
  success: boolean;
  configVersion: number | null;
  latencyMs: number | null;
  error: string | null;
  retries: number;
}

/** Result of pushing config to all panels */
export interface PushAllResult {
  totalPanels: number;
  succeeded: number;
  failed: number;
  results: PushResult[];
  configVersion: number;
  pushedAt: string;
}

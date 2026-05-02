import { signPayload } from './hmac';
import type { ChainConfig } from '@/types/chain';
import type { PanelSyncPayload, PanelChainNode, PanelRoutingRule, PushResult, PushAllResult } from '@/types/panel-sync.ts';
import { broadcastEvent } from './websocket';
import { enrichError } from './error-reporter';

// ─── Constants ──────────────────────────────────────────

const RETRY_DELAYS = [1000, 2000, 4000];

// ─── Helpers ────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── generatePerPanelConfig ─────────────────────────────

/**
 * Generate a per-panel sync payload from a chain config.
 * Returns null if the panel has no role in this chain.
 */
export function generatePerPanelConfig(chainConfig: ChainConfig, panelId: number): PanelSyncPayload | null {
  const matchedNode = chainConfig.nodes.find((node) => node.serverId === panelId);

  if (!matchedNode) {
    return null;
  }

  // Include ALL chain nodes (full topology for routing decisions)
  const chainNodes: PanelChainNode[] = chainConfig.nodes.map((node) => ({
    label: node.label,
    serverId: node.serverId,
    role: node.role,
    protocol: node.protocol,
    hostname: node.hostname,
    port: node.port,
  }));

  // Filter routing rules: only those whose nodeId matches the matched node's label
  const routingRules: PanelRoutingRule[] = chainConfig.xrayRoutingRules
    .filter((rule) => rule.nodeId === matchedNode.label)
    .map((rule) => ({
      type: rule.type,
      value: rule.value,
      outboundTag: rule.outboundTag,
      priority: rule.priority,
    }));

  // Filter wireguard peers: only those whose nodeId matches the matched node's label
  const wireguardPeers = chainConfig.wireguardPeers
    .filter((peer) => peer.nodeId === matchedNode.label)
    .map((peer) => ({
      publicKey: peer.publicKey,
      allowedIPs: peer.allowedIPs,
      endpoint: peer.endpoint,
      persistentKeepalive: peer.persistentKeepalive,
    }));

  return {
    configVersion: 0, // Placeholder — real version set at push time
    panelRole: matchedNode.role,
    chainNodes,
    routingRules,
    wireguardPeers,
    generatedAt: chainConfig.generatedAt,
  };
}

// ─── pushConfigToPanel ──────────────────────────────────

/**
 * Push a config payload to a single remote panel.
 * Retries up to 3 times total with exponential backoff (1s, 2s, 4s).
 */
export async function pushConfigToPanel(
  panel: { id: number; name: string; panelUrl: string; apiKey: string },
  payload: PanelSyncPayload,
): Promise<PushResult> {
  const url = `${panel.panelUrl}/api/sync/receive`;
  const signature = signPayload(payload, panel.apiKey);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': panel.apiKey,
    'X-Signature': signature,
  };

  let lastError: string | null = null;
  let retries = 0;
  const startTime = Date.now();

  // Initial attempt + up to 2 retries = 3 total attempts
  broadcastEvent('panel:push-progress', {
    panelId: panel.id,
    panelName: panel.name,
    status: 'pushing',
    timestamp: new Date().toISOString(),
  });

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const resp = await response.json();
        const data = resp.data;
        if (data?.applied && typeof data.configVersion === 'number') {
          const latencyMs = Date.now() - startTime;
          broadcastEvent('panel:push-progress', {
            panelId: panel.id,
            panelName: panel.name,
            status: 'success',
            latencyMs,
            timestamp: new Date().toISOString(),
          });
          return {
            panelId: panel.id,
            panelName: panel.name,
            success: true,
            configVersion: data.configVersion,
            latencyMs,
            error: null,
            retries,
          };
        }
      }

      lastError = `HTTP ${response.status}: ${response.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    // If we have retries left, wait before trying again
    if (attempt < RETRY_DELAYS.length) {
      retries++;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  broadcastEvent('panel:push-progress', {
    panelId: panel.id,
    panelName: panel.name,
    status: 'failed',
    error: enrichError(lastError || 'Unknown error', panel.name),
    timestamp: new Date().toISOString(),
  });

  return {
    panelId: panel.id,
    panelName: panel.name,
    success: false,
    configVersion: null,
    latencyMs: Date.now() - startTime,
    error: lastError,
    retries,
  };
}

// ─── pushConfigToAllPanels ──────────────────────────────

/**
 * Push chain config to all active remote panels sequentially.
 * Increments configVersion starting from 1 for each panel in the batch.
 */
export async function pushConfigToAllPanels(
  chainConfig: ChainConfig,
  panelApiKeys: Map<number, string>,
): Promise<PushAllResult> {
  const { prisma } = await import('./prisma');

  const panels = await prisma.remotePanel.findMany({
    where: { isActive: true },
  });

  const results: PushResult[] = [];
  let configVersion = 0;

  for (const panel of panels) {
    const panelConfig = generatePerPanelConfig(chainConfig, panel.id);

    if (!panelConfig) {
      // Panel has no role in this chain — skip
      continue;
    }

    const apiKey = panelApiKeys.get(panel.id);
    if (!apiKey) {
      results.push({
        panelId: panel.id,
        panelName: panel.name,
        success: false,
        configVersion: null,
        latencyMs: null,
        error: 'No API key provided for panel',
        retries: 0,
      });
      continue;
    }

    configVersion++;
    panelConfig.configVersion = configVersion;

    const result = await pushConfigToPanel(
      { id: panel.id, name: panel.name, panelUrl: panel.panelUrl, apiKey },
      panelConfig,
    );

    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    totalPanels: results.length,
    succeeded,
    failed,
    results,
    configVersion,
    pushedAt: new Date().toISOString(),
  };
}
